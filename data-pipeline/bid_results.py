"""Verify full bid results (all bidders, prices, scores) read from award resolutions /
committee minutes, and link bidders to their tax ID (NIF).

    uv run --with pymupdf bid_results.py            # every file in out/bids/

Input: out/bids/<tender_id>.json, written by hand or by Claude from the documents in
raw/docs/<tender_id>/ ("Acta", "Informe de valoración", "Resolución de adjudicación").
Each bid and the summary carry {doc, page, quote}; the quote is checked against the PDF
like extract_tender.py does. Bidders get a NIF when their name matches a winner name with
a known NIF anywhere in out/tenders.jsonl (losing bidders are never published with NIF).

Why it matters: PLACSP's structured data only names the winner. Losers, their prices and
scores exist only in these PDFs, and they're what competitor analysis needs.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import fitz

from extract_tender import DOCS, verify

ROOT = Path(__file__).parent
BIDS = ROOT / "out" / "bids"
LEGAL = r"\b(s ?l ?u?|s ?a ?u?|slu|sau|sl|sa|s l p|lda|unipessoal|sociedad limitada|sociedad anonima)\b"


def name_key(name: str) -> str:
    """Normalise a company name for matching: accents, punctuation and legal form removed."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(LEGAL, " ", s)
    return " ".join(s.split())


def nif_index() -> dict[str, str]:
    idx: dict[str, str] = {}
    for line in (ROOT / "out" / "tenders.jsonl").open(encoding="utf-8"):
        for r in json.loads(line)["results"]:
            if r.get("winner_nif") and r.get("winner_name") and "*" not in r["winner_nif"]:  # masked = unknown
                idx.setdefault(name_key(r["winner_name"]), r["winner_nif"])
    return idx


def opening_report_nifs(pdfs: dict[str, fitz.Document]) -> dict[str, str]:
    """PLACSP opening reports list every bidder as 'Razón social: X' + 'NIF: Y'. Company NIFs only:
    personal ID numbers (DNI/NIE: start with a digit or X/Y/Z) of sole traders are personal data, skipped."""
    found: dict[str, str] = {}
    for doc in pdfs.values():
        text = "\n".join(page.get_text() for page in doc)
        pairs = re.findall(r"Raz[oó]n social:\s*(.+?)\s*\n\s*NIF:\s*([A-Z0-9]{8,10})", text)
        pairs += re.findall(r"-\s+(.+?)\s+-\s+(?:CIF|NIF):\s*([A-Z0-9]{8,10})", text)   # "- Name - CIF: X" format
        for name, nif in pairs:
            if re.match(r"^[A-HJ-NP-SUVW]\d{7}[0-9A-J]$", nif):
                found.setdefault(name_key(name), nif)
    return found


def locate(item: dict, pdfs: dict[str, fitz.Document]) -> None:
    """If an item has no page yet, find the first page of its doc containing the quote."""
    from extract_tender import _norm
    doc = pdfs.get(item.get("doc", ""))
    if item.get("page") or doc is None or not item.get("quote"):
        return
    probe = " ".join(_norm(item["quote"]).split()[:8])
    for i, page in enumerate(doc, 1):
        if probe in _norm(page.get_text()):
            item["page"] = i
            return


def main() -> None:
    idx = nif_index()
    for path in sorted(BIDS.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        tid = data["tender_id"]
        pdfs = {p.stem: fitz.open(p) for p in sorted((DOCS / tid).glob("*.pdf"))}
        items = [data["summary"], *data["bids"]]
        for it in items:
            locate(it, pdfs)
            verify(it, pdfs)
        local = opening_report_nifs(pdfs)
        for bid in data["bids"]:
            key = name_key(bid["bidder_name"])
            bid["bidder_nif"] = local.get(key) or idx.get(key)
        ok = sum(i["verified"] for i in items)
        linked = sum(1 for b in data["bids"] if b["bidder_nif"])
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"{tid}: citations verified {ok}/{len(items)}, bidders linked to NIF {linked}/{len(data['bids'])}")
        for i in items:
            if not i["verified"]:
                print(f"  NOT FOUND p{i.get('page')} {i.get('doc')}: {i.get('quote')[:80]}")


if __name__ == "__main__":
    main()
