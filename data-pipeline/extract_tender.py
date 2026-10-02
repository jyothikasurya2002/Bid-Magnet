"""Turn a tender's PDFs (PCAP + PPT) into a cited bid checklist with Claude.

    uv run --with anthropic --with pymupdf extract_tender.py 20602902
    uv run --with anthropic --with pymupdf extract_tender.py --all      # every folder in raw/docs/

Reads raw/docs/<tender_id>/*.pdf, writes out/extractions/<tender_id>.json.
Needs ANTHROPIC_API_KEY in the environment or in data-pipeline/.env.

Every extracted item carries {doc, page, quote}. After extraction we open the PDF
and check that the quote really appears on that page ("verified"); the UI should
flag unverified items for human review instead of hiding them.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

import fitz  # pymupdf

ROOT = Path(__file__).parent
DOCS = ROOT / "raw" / "docs"
OUT = ROOT / "out" / "extractions"
MODEL = "claude-opus-5-5"
MAX_REQUEST_BYTES = 32 * 1024 * 1024

# ---------------------------------------------------------------- output schema
# This is the contract with the frontend. Change it here and tell the team.

def _cited(props: dict) -> dict:
    """Object with the given fields plus a citation (doc, page, quote)."""
    props = {**props,
             "doc": {"type": "string", "description": "Which document: the file label given in the prompt"},
             "page": {"type": "integer", "description": "1-based PDF page number"},
             "quote": {"type": "string", "description": "Short verbatim quote (5-25 words) from that page, in the original language"}}
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


S = {"type": "string"}
S_NULL = {"type": ["string", "null"]}
N_NULL = {"type": ["number", "null"]}

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "key_dates", "envelopes", "mandatory_documents", "eligibility",
                 "award_criteria", "price", "exclusion_risks", "review_notes"],
    "properties": {
        "summary": {
            "type": "object", "additionalProperties": False,
            "required": ["object_en", "object_es", "contract_type", "budget_no_tax", "duration",
                         "extensions", "lots", "submission"],
            "properties": {
                "object_en": {**S, "description": "What is being bought, 1-2 sentences in English"},
                "object_es": {**S, "description": "Same in Spanish"},
                "contract_type": S,
                "budget_no_tax": {**N_NULL, "description": "Base budget excluding VAT, EUR"},
                "duration": S,
                "extensions": {**S_NULL, "description": "Possible extensions (prórrogas); key for renewal radar"},
                "lots": {"type": "array", "items": {"type": "object", "additionalProperties": False,
                         "required": ["lot", "name", "budget_no_tax"],
                         "properties": {"lot": S, "name": S, "budget_no_tax": N_NULL}}},
                "submission": {**S, "description": "How/where bids are submitted, e.g. electronically via PLACSP"},
            },
        },
        "key_dates": {"type": "array", "items": _cited({"label": S, "date": S_NULL})},
        "envelopes": {"type": "array", "description": "Sobres / archivos electrónicos and what goes in each",
                      "items": _cited({"name": S, "contents": {"type": "array", "items": S}})},
        "mandatory_documents": {"type": "array", "items": _cited({
            "name": S,
            "description_en": S,
            "envelope": S_NULL,
            "when": {"type": "string", "enum": ["with_bid", "awardee_only", "unclear"]},
        })},
        "eligibility": {"type": "array", "items": _cited({
            "category": {"type": "string", "enum": [
                "financial_solvency", "technical_solvency", "classification", "certification",
                "registry", "insurance", "team", "experience", "other"]},
            "requirement_en": S,
            "threshold": {**S_NULL, "description": "Numeric threshold as written, e.g. '150.000 € annual turnover'"},
            "alternative": {**S_NULL, "description": "Alternative way to prove it, e.g. classification instead of solvency"},
        })},
        "award_criteria": {"type": "array", "items": _cited({
            "name": S,
            "kind": {"type": "string", "enum": ["price", "automatic_formula", "judgement"]},
            "points": N_NULL,
            "how_scored_en": S,
            "envelope": S_NULL,
        })},
        "price": _cited({
            "formula": {**S_NULL, "description": "Price scoring formula exactly as written"},
            "formula_explained_en": S_NULL,
            "abnormally_low_rule": {**S_NULL, "description": "Rule for ofertas anormalmente bajas / temerarias"},
            "provisional_guarantee": S_NULL,
            "definitive_guarantee": S_NULL,
        }),
        "exclusion_risks": {"type": "array", "description": "Things that would get a bid excluded",
                            "items": _cited({"risk_en": S})},
        "review_notes": {"type": "array", "items": S,
                         "description": "Anything ambiguous, contradictory, or that a human must check"},
    },
}

SYSTEM = """You are a Spanish public-procurement bid analyst helping an IT company decide whether \
and how to bid. You read the tender's pliegos (PCAP = administrative clauses, PPT = technical \
specifications, and annexes) and extract what a bidder needs.

Rules:
- Only state what the documents say. If something isn't in them, leave it out or put null; never guess.
- Every item cites the document label, the 1-based PDF page, and a short verbatim quote copied \
exactly from that page (original Spanish/Catalan/etc., no translation, no paraphrase).
- Missing a mandatory requirement can get a bid excluded, so be exhaustive on mandatory documents, \
envelopes, eligibility and exclusion risks.
- Write the *_en fields in plain English for a non-lawyer."""


# ---------------------------------------------------------------- helpers

def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


XML_DOC = "placsp_xml"  # cite the PLACSP structured record when a fact is only there (e.g. tables drawn as images)


def xml_record_text(tender_id: str) -> str:
    """Normalised text of the tender's parsed PLACSP record, for verifying XML_DOC citations."""
    path = ROOT / "out" / "tenders.jsonl"
    if path.exists():
        for line in path.open(encoding="utf-8"):
            if f'"id": "{tender_id}"' in line[:200]:
                return _norm(line)
    return ""


def verify(item: dict, pdfs: dict[str, fitz.Document], xml_text: str = "") -> None:
    """Mark item['verified'] = True if its quote appears on the cited page (±1 page)."""
    quote = _norm(item.get("quote") or "")
    words = quote.split()
    probe = " ".join(words[:8])  # first ~8 words survive line breaks/hyphenation well enough
    if item.get("doc") == XML_DOC:
        item["verified"] = bool(probe) and probe in xml_text
        return
    doc = pdfs.get(item.get("doc", ""))
    item["verified"] = False
    if doc is None or not quote:
        return
    page = item.get("page") or 0
    for p in (page, page - 1, page + 1):
        if 1 <= p <= doc.page_count and probe in _norm(doc[p - 1].get_text()):
            item["verified"] = True
            if p != page:
                item["page"] = p
            return


def walk_cited(obj):
    if isinstance(obj, dict):
        if "quote" in obj and "page" in obj:
            yield obj
        for v in obj.values():
            yield from walk_cited(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from walk_cited(v)


# ---------------------------------------------------------------- main

def verify_existing(tender_id: str) -> None:
    """Re-check citations of an extraction JSON (e.g. one written by hand or by Claude Code)."""
    dest = OUT / f"{tender_id}.json"
    data = json.loads(dest.read_text(encoding="utf-8"))
    pdfs = {p.stem: fitz.open(p) for p in sorted((DOCS / tender_id).glob("*.pdf"))}
    cited = list(walk_cited({k: v for k, v in data.items() if k != "_meta"}))
    xml_text = xml_record_text(tender_id)
    for item in cited:
        verify(item, pdfs, xml_text)
    bad = [i for i in cited if not i["verified"]]
    meta = data.setdefault("_meta", {})
    meta.update({"tender_id": tender_id, "documents": [f"{k}.pdf" for k in pdfs],
                 "pages": sum(d.page_count for d in pdfs.values()),
                 "citations": len(cited), "citations_verified": len(cited) - len(bad)})
    dest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{tender_id}: citations verified {len(cited) - len(bad)}/{len(cited)}")
    for i in bad:
        print(f"  NOT FOUND p{i.get('page')} {i.get('doc')}: {i.get('quote')[:80]}")


def extract(tender_id: str, client) -> dict:
    folder = DOCS / tender_id
    files = sorted(p for p in folder.glob("*.pdf"))
    if not files:
        raise SystemExit(f"no PDFs in {folder}")
    total = sum(p.stat().st_size for p in files)
    if total * 4 / 3 > MAX_REQUEST_BYTES:  # base64 overhead
        raise SystemExit(f"{tender_id}: PDFs too large for one request ({total / 1e6:.1f} MB); split them")

    content, pdfs = [], {}
    for p in files:
        label = p.stem  # e.g. "pcap__Pliego Administrativo"
        pdfs[label] = fitz.open(p)
        content.append({"type": "text", "text": f"Document label: {label}"})
        content.append({"type": "document", "title": label, "source": {
            "type": "base64", "media_type": "application/pdf",
            "data": base64.standard_b64encode(p.read_bytes()).decode()}})
    content.append({"type": "text", "text": "Extract the bid checklist for this tender."})
    pages = sum(d.page_count for d in pdfs.values())
    print(f"{tender_id}: {len(files)} PDFs, {pages} pages -> {MODEL}")

    with client.beta.messages.stream(
        model=MODEL,
        max_tokens=64000,
        system=SYSTEM,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    ) as stream:
        msg = stream.get_final_message()

    if msg.stop_reason == "refusal":
        raise SystemExit(f"{tender_id}: model declined ({msg.stop_details})")
    if msg.stop_reason == "max_tokens":
        raise SystemExit(f"{tender_id}: output truncated at max_tokens")
    text = next(b.text for b in msg.content if b.type == "text")
    data = json.loads(text)

    cited = list(walk_cited(data))
    xml_text = xml_record_text(tender_id)
    for item in cited:
        verify(item, pdfs, xml_text)
    ok = sum(i["verified"] for i in cited)

    u = msg.usage
    cost = (u.input_tokens * 4 + (u.cache_creation_input_tokens or 0) * 5
            + (u.cache_read_input_tokens or 0) * 0.4 + u.output_tokens * 20) / 1e6
    data["_meta"] = {
        "tender_id": tender_id, "model": msg.model, "documents": [p.name for p in files], "pages": pages,
        "citations": len(cited), "citations_verified": ok,
        "input_tokens": u.input_tokens, "output_tokens": u.output_tokens, "approx_cost_usd": round(cost, 3),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"{tender_id}.json"
    dest.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  -> {dest.relative_to(ROOT)}  citations verified {ok}/{len(cited)}  ~${cost:.2f}")
    return data


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("tender_ids", nargs="*")
    ap.add_argument("--all", action="store_true", help="every folder in raw/docs/ without an extraction yet")
    ap.add_argument("--verify", action="store_true", help="only re-check citations of existing JSON (no API call)")
    args = ap.parse_args()
    if args.verify:
        for tid in args.tender_ids:
            verify_existing(tid)
        return
    import anthropic
    load_env()
    if not os.environ.get("ANTHROPIC_API_KEY"):
        sys.exit("ANTHROPIC_API_KEY not set. Put it in data-pipeline/.env (see .env.example).")
    ids = args.tender_ids or ([p.name for p in sorted(DOCS.iterdir())
                               if p.is_dir() and not (OUT / f"{p.name}.json").exists()] if args.all else [])
    if not ids:
        sys.exit("give tender ids or --all")
    client = anthropic.Anthropic()
    for tid in ids:
        extract(tid, client)


if __name__ == "__main__":
    main()
