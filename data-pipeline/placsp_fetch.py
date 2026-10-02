"""Download PLACSP feeds and tender documents. Standard library only.

    python placsp_fetch.py month 202609            # monthly zip -> raw/placsp_202609.zip
    python placsp_fetch.py month 202609 --feed regional   # Catalonia, Basque Country... -> raw/placsp_agg_202609.zip
    python placsp_fetch.py live --pages 3          # newest pages of the live feed -> raw/live/
    python placsp_fetch.py docs --open-only        # PCAP/PPT PDFs for IT tenders in out/ -> raw/docs/
    python placsp_fetch.py docs --ids 20571626     # just these tenders

PLACSP serves a certificate chained to the Spanish FNMT root, which most CA
stores (macOS, Ubuntu runners) don't trust. We add certs/fnmt_chain.pem on top
of the system store instead of disabling verification.

The server is slow (~100 KB/s) and doesn't support resuming, so big downloads
are retried from scratch.
"""

from __future__ import annotations

import argparse
import csv
import re
import shutil
import ssl
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
RAW = ROOT / "raw"
HOST = "https://contrataciondelsectorpublico.gob.es/sindicacion"
# national = tenders published on PLACSP itself; regional = other platforms (Catalonia, Basque
# Country, Madrid, Andalucía, Galicia, Navarra, ...) that PLACSP republishes in the same format
FEEDS = {
    "national": ("sindicacion_643/licitacionesPerfilesContratanteCompleto3", "placsp_{}.zip", "live"),
    "regional": ("sindicacion_1044/PlataformasAgregadasSinMenores", "placsp_agg_{}.zip", "live_agg"),
}

_ctx = ssl.create_default_context()
_ctx.load_verify_locations(ROOT / "certs" / "fnmt_chain.pem")


def download(url: str, dest: Path, timeout: int = 3600, retries: int = 3) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "BidMagnet-data/0.1"})
            with urllib.request.urlopen(req, context=_ctx, timeout=timeout) as r, tmp.open("wb") as fh:
                shutil.copyfileobj(r, fh, length=1 << 20)
            tmp.replace(dest)
            return dest
        except Exception as e:  # network errors on this server are common; retry
            print(f"  attempt {attempt}/{retries} failed: {e}", file=sys.stderr)
            time.sleep(5 * attempt)
    raise RuntimeError(f"giving up on {url}")


def fetch_month(month: str, feed: str = "national") -> Path:
    path, filename, _ = FEEDS[feed]
    dest = RAW / filename.format(month)
    print(f"downloading {feed} {month} (can take 10-30 min) ...")
    return download(f"{HOST}/{path}_{month}.zip", dest)


def fetch_live(pages: int, feed: str = "national") -> list[Path]:
    """Follow rel=next links from the newest page. Each page is ~500 entries, ~12 MB."""
    path, _, live_dir = FEEDS[feed]
    url = f"{HOST}/{path}.atom"
    out = []
    for i in range(pages):
        dest = RAW / live_dir / f"page_{i:03d}.atom"
        print(f"page {i}: {url}")
        download(url, dest, timeout=600)
        out.append(dest)
        head = dest.read_bytes()[:4000].decode("utf-8", "ignore")
        m = re.search(r'<link href="([^"]+)" rel="next"', head)
        if not m:
            break
        # Feed links use the old domain; both serve the same files
        url = m.group(1).replace("https://contrataciondelestado.es", "https://contrataciondelsectorpublico.gob.es")
    return out


def fetch_docs(open_only: bool, limit: int, kinds: set[str], ids: set[str] | None = None) -> None:
    tenders = {r["id"]: r for r in csv.DictReader((ROOT / "out" / "tenders.csv").open(encoding="utf-8-sig"))}
    today = date.today().isoformat()
    if ids:
        tenders = {k: t for k, t in tenders.items() if k in ids}
    if open_only:
        tenders = {k: t for k, t in tenders.items() if t["status"] == "PUB" and t["deadline_date"] >= today}
    docs = [d for d in csv.DictReader((ROOT / "out" / "documents.csv").open(encoding="utf-8-sig"))
            if d["tender_id"] in tenders and d["kind"] in kinds]
    print(f"{len(docs)} documents for {len(tenders)} tenders")
    for n, d in enumerate(docs[:limit], 1):
        name = re.sub(r"[^\w.\- ]", "_", d["name"] or "document")[:120]
        if not name.lower().endswith((".pdf", ".docx", ".doc", ".zip", ".odt", ".xlsx")):
            name += ".pdf"
        dest = RAW / "docs" / d["tender_id"] / f"{d['kind']}__{name}"
        if dest.exists():
            continue
        print(f"[{n}] {d['tender_id']} {d['kind']} {d['name']}")
        try:
            download(d["url"], dest, timeout=300, retries=2)
        except RuntimeError as e:
            print(f"  skipped: {e}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("month"); m.add_argument("months", nargs="+", help="YYYYMM, or YYYY for a full year")
    m.add_argument("--feed", choices=FEEDS, default="national")
    lv = sub.add_parser("live"); lv.add_argument("--pages", type=int, default=1)
    lv.add_argument("--feed", choices=FEEDS, default="national")
    dc = sub.add_parser("docs")
    dc.add_argument("--open-only", action="store_true", help="only tenders still accepting bids")
    dc.add_argument("--limit", type=int, default=200)
    dc.add_argument("--kinds", default="pcap,ppt", help="pcap,ppt,additional,general,notice")
    dc.add_argument("--ids", help="comma list of tender ids (default: all)")
    args = ap.parse_args()

    if args.cmd == "month":
        for mo in args.months:
            fetch_month(mo, args.feed)
    elif args.cmd == "live":
        fetch_live(args.pages, args.feed)
    else:
        fetch_docs(args.open_only, args.limit, set(args.kinds.split(",")),
                   set(args.ids.split(",")) if args.ids else None)


if __name__ == "__main__":
    main()
