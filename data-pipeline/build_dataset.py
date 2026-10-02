"""Build the IT tender dataset from downloaded PLACSP files.

    python build_dataset.py raw/placsp_202609.zip raw/placsp_202608.zip
    python build_dataset.py raw/live.atom --segments core,hardware

Writes to out/:
    tenders.csv / tenders.jsonl   one row per tender (latest version), IT only
    criteria.csv                  award criteria + weights
    documents.csv                 PDF links (PCAP, PPT, award resolutions...)
    results.csv                   awards: winner, bidder count, lowest/highest bid
    requirements.csv              solvency / qualification requirements
    stats.md                      coverage numbers for the team
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import date
from pathlib import Path

from placsp_parse import iter_source, latest_versions

OUT = Path(__file__).parent / "out"

TENDER_COLS = [
    "id", "folder_id", "title", "status", "status_label", "buyer_name", "buyer_nif", "buyer_city",
    "region", "contract_type_label", "procedure_label", "budget_no_tax", "estimated_value",
    "cpv_codes", "it_segment", "deadline_date", "deadline_time", "duration", "duration_unit",
    "has_lots", "n_criteria", "price_weight", "n_documents", "has_pcap", "has_ppt", "updated", "link",
]


NUTS2_REGION = {
    "ES11": "Galicia", "ES12": "Asturias", "ES13": "Cantabria", "ES21": "País Vasco", "ES22": "Navarra",
    "ES23": "La Rioja", "ES24": "Aragón", "ES30": "Madrid", "ES41": "Castilla y León",
    "ES42": "Castilla-La Mancha", "ES43": "Extremadura", "ES51": "Cataluña", "ES52": "Comunitat Valenciana",
    "ES53": "Illes Balears", "ES61": "Andalucía", "ES62": "Murcia", "ES63": "Ceuta", "ES64": "Melilla",
    "ES70": "Canarias",
}


def region_of(t: dict) -> str | None:
    """Autonomous community where the contract is performed (from its NUTS code)."""
    nuts = t.get("nuts_code") or ""
    if nuts[:4] in NUTS2_REGION:
        return NUTS2_REGION[nuts[:4]]
    return "Nacional" if nuts == "ES" else None


def price_weight(t: dict) -> float | None:
    w = [c["weight"] for c in t["criteria"] if c["subtype"] == "1" and c["weight"] is not None and not c["lot_id"]]
    return sum(w) if w else None


def flat_tender(t: dict) -> dict:
    kinds = {d["kind"] for d in t["documents"]}
    row = {k: t.get(k) for k in TENDER_COLS}
    row.update({
        "region": region_of(t),
        "cpv_codes": "|".join(t["cpv_codes"]),
        "n_criteria": len(t["criteria"]),
        "price_weight": price_weight(t),
        "n_documents": len(t["documents"]),
        "has_pcap": "pcap" in kinds,
        "has_ppt": "ppt" in kinds,
    })
    return row


def write_csv(path: Path, rows: list[dict], cols: list[str] | None = None) -> None:
    cols = cols or (list(rows[0].keys()) if rows else [])
    with path.open("w", newline="", encoding="utf-8-sig") as fh:  # utf-8-sig so Excel shows accents
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def child_rows(tenders: list[dict], key: str) -> list[dict]:
    rows = []
    for t in tenders:
        for item in t[key]:
            rows.append({"tender_id": t["id"], "folder_id": t["folder_id"], **item})
    return rows


def pct(n: int, d: int) -> str:
    return f"{n} / {d} ({100 * n / d:.0f}%)" if d else "0 / 0"


def stats_md(all_tenders: list[dict], it: list[dict], sources: list[str]) -> str:
    today = date.today().isoformat()
    open_it = [t for t in it if t["status"] == "PUB" and (t["deadline_date"] or "") >= today]
    awarded = [t for t in it if t["results"]]
    res = [r for t in awarded for r in t["results"]]
    with_docs = [t for t in it if any(d["kind"] in ("pcap", "ppt") for d in t["documents"])]
    award_docs = [t for t in awarded if any(d["kind"] == "notice" for d in t["documents"])]
    discounts = []
    for t in awarded:
        for r in t["results"]:
            if r["award_amount_no_tax"] and t["budget_no_tax"] and not r["lot_id"]:
                discounts.append(1 - r["award_amount_no_tax"] / t["budget_no_tax"])
    discounts.sort()
    winners = Counter(r["winner_name"] for r in res if r["winner_name"])
    buyers = Counter(t["buyer_name"] for t in it)
    lines = [
        "# PLACSP IT tender dataset: coverage stats",
        f"_Generated {today} from: {', '.join(sources)}_",
        "",
        "## Volume",
        f"- Tenders in source (latest version each): **{len(all_tenders)}**",
        f"- IT tenders: **{len(it)}**: " + ", ".join(f"{k}: {v}" for k, v in Counter(t['it_segment'] for t in it).most_common()),
        f"- IT tenders open today (status PUB, deadline ≥ today): **{len(open_it)}**",
        "- By status: " + ", ".join(f"{k}: {v}" for k, v in Counter(t['status'] for t in it).most_common()),
        "- By procedure: " + ", ".join(f"{k}: {v}" for k, v in Counter(t['procedure_label'] for t in it).most_common(6)),
        "- By region: " + ", ".join(f"{k}: {v}" for k, v in Counter(region_of(t) for t in it).most_common(8)),
        "",
        "## Data available for the product",
        f"- Have PCAP or PPT PDF link: {pct(len(with_docs), len(it))}",
        f"- Have award criteria with weights in XML: {pct(sum(1 for t in it if t['criteria']), len(it))}",
        f"- Awarded tenders with result data: {len(awarded)}",
        f"  - with bidder count: {pct(sum(1 for r in res if r['received_tenders'] is not None), len(res))}",
        f"  - with winner tax ID (NIF): {pct(sum(1 for r in res if r['winner_nif']), len(res))}",
        f"  - with lowest/highest bid: {pct(sum(1 for r in res if r['lowest_bid'] is not None), len(res))}",
        f"  - with award notice / resolution PDFs: {pct(len(award_docs), len(awarded))}",
    ]
    if discounts:
        mid = discounts[len(discounts) // 2]
        lines.append(f"- Median discount (award vs budget, single-lot): **{mid:.0%}** across {len(discounts)} awards")
    if res:
        bc = sorted(r["received_tenders"] for r in res if r["received_tenders"] is not None)
        if bc:
            lines.append(f"- Median bidders per award: **{bc[len(bc) // 2]}**")
    lines += ["", "## Top IT buyers"] + [f"- {n}: {c}" for n, c in buyers.most_common(10)]
    lines += ["", "## Top IT winners"] + [f"- {n}: {c}" for n, c in winners.most_common(10)]
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sources", nargs="+", help=".zip, .atom or a folder of .atom files")
    ap.add_argument("--segments", default="core", help="comma list: core,hardware,telecom_network or 'all'")
    args = ap.parse_args()

    def records():
        for s in args.sources:
            print(f"parsing {s} ...")
            yield from iter_source(s)

    latest, gone = latest_versions(records())
    all_tenders = list(latest.values())
    segs = None if args.segments == "all" else set(args.segments.split(","))
    it = [t for t in all_tenders if t["it_segment"] and (segs is None or t["it_segment"] in segs)]
    it.sort(key=lambda t: t["updated"] or "", reverse=True)

    OUT.mkdir(exist_ok=True)
    with (OUT / "tenders.jsonl").open("w", encoding="utf-8") as fh:
        for t in it:
            fh.write(json.dumps(t, ensure_ascii=False) + "\n")
    write_csv(OUT / "tenders.csv", [flat_tender(t) for t in it], TENDER_COLS)
    write_csv(OUT / "criteria.csv", child_rows(it, "criteria"))
    write_csv(OUT / "documents.csv", child_rows(it, "documents"))
    write_csv(OUT / "results.csv", child_rows(it, "results"))
    write_csv(OUT / "requirements.csv", child_rows(it, "requirements"))
    (OUT / "stats.md").write_text(stats_md(all_tenders, it, args.sources), encoding="utf-8")

    print(f"{len(all_tenders)} tenders, {len(gone)} deleted, {len(it)} IT -> {OUT}/")
    print((OUT / "stats.md").read_text())


if __name__ == "__main__":
    main()
