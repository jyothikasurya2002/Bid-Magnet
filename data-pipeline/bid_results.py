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


def main() -> None:
    idx = nif_index()
    for path in sorted(BIDS.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        tid = data["tender_id"]
        pdfs = {p.stem: fitz.open(p) for p in sorted((DOCS / tid).glob("*.pdf"))}
        items = [data["summary"], *data["bids"]]
        for it in items:
            verify(it, pdfs)
        for bid in data["bids"]:
            bid["bidder_nif"] = idx.get(name_key(bid["bidder_name"]))
        ok = sum(i["verified"] for i in items)
        linked = sum(1 for b in data["bids"] if b["bidder_nif"])
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"{tid}: citations verified {ok}/{len(items)}, bidders linked to NIF {linked}/{len(data['bids'])}")
        for i in items:
            if not i["verified"]:
                print(f"  NOT FOUND p{i.get('page')} {i.get('doc')}: {i.get('quote')[:80]}")


if __name__ == "__main__":
    main()
