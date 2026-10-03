"""Export dashboard-ready CSVs for Power BI (or Excel/Tableau) from out/tenders.jsonl.

    python3 powerbi_export.py          # -> out/powerbi/tenders.csv, out/powerbi/results.csv

Differences from out/tenders.csv / out/results.csv:
- English labels (status, contract type, procedure, IT segment) and a data source column
- ISO dates only (YYYY-MM-DD), '.' decimals, UTF-8 with BOM: imports cleanly in any locale
- Ready-made bands for charts: budget band, competition band, months to deadline
- results.discount_pct = 1 - award / budget of the same lot (blank when not comparable)
Join in Power BI: tenders[tender_id] 1 --- * results[tender_id].
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from build_dataset import price_weight, region_of

ROOT = Path(__file__).parent
OUT = ROOT / "out" / "powerbi"

STATUS = {"PRE": "Prior notice", "PUB": "Open for bids", "EV": "Under evaluation", "ADJ": "Awarded",
          "RES": "Resolved", "ANUL": "Cancelled"}
CONTRACT = {"Suministros": "Supplies", "Servicios": "Services", "Obras": "Works",
            "Administrativo especial": "Special administrative", "Privado": "Private",
            "Concesión de servicios": "Service concession"}
PROCEDURE = {"Abierto": "Open", "Abierto simplificado": "Simplified open", "Restringido": "Restricted",
             "Negociado sin publicidad": "Negotiated (no publicity)", "Negociado con publicidad": "Negotiated (with publicity)",
             "Derivado de acuerdo marco": "Framework call-off", "Basado en sistema dinámico de adquisición": "Dynamic purchasing system",
             "Licitación con negociación": "Competitive with negotiation", "Diálogo competitivo": "Competitive dialogue",
             "Normas internas": "Internal rules", "Otros": "Other", "Concurso de proyectos": "Design contest",
             "Asociación para la innovación": "Innovation partnership"}
SEGMENT = {"core": "Software & IT services", "hardware": "IT hardware", "telecom_network": "Telecom & networks"}
COMPETITIVE = {"Open", "Simplified open", "Restricted", "Negotiated (with publicity)", "Competitive with negotiation",
               "Competitive dialogue"}


def budget_band(v: float | None) -> str:
    if v is None:
        return "Unknown"
    for limit, label in ((15000, "1. < 15k €"), (60000, "2. 15k–60k €"), (150000, "3. 60k–150k €"),
                         (1000000, "4. 150k–1M €")):
        if v < limit:
            return label
    return "5. > 1M €"


def competition_band(n: int | None) -> str:
    if n is None:
        return "Unknown"
    if n <= 1:
        return "1. Single bid"
    if n <= 3:
        return "2. 2–3 bids"
    if n <= 9:
        return "3. 4–9 bids"
    return "4. 10+ bids"


def months(duration, unit) -> float | None:
    if duration is None:
        return None
    return round({"ANN": duration * 12, "MON": duration, "DAY": duration / 30.4}.get(unit, duration), 1)


def write(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tenders, results = [], []
    for line in (ROOT / "out" / "tenders.jsonl").open(encoding="utf-8"):
        t = json.loads(line)
        procedure = PROCEDURE.get(t["procedure_label"] or "", t["procedure_label"] or "Unknown")
        kinds = {d["kind"] for d in t["documents"]}
        lot_budget = {l["lot_id"]: l["budget_no_tax"] for l in t["lots"]}
        tenders.append({
            "tender_id": t["id"],
            "title": t["title"],
            "status": STATUS.get(t["status"] or "", t["status"]),
            "buyer_name": t["buyer_name"],
            "buyer_nif": t["buyer_nif"],
            "region": region_of(t) or "Unknown",
            "data_source": "Regional platform" if t.get("source") == "regional" else "National platform (PLACSP)",
            "contract_type": CONTRACT.get(t["contract_type_label"] or "", t["contract_type_label"] or "Unknown"),
            "procedure": procedure,
            "competitive_procedure": "Yes" if procedure in COMPETITIVE else "No",
            "it_segment": SEGMENT.get(t["it_segment"], t["it_segment"]),
            "budget_eur": t["budget_no_tax"],
            "estimated_value_eur": t["estimated_value"],
            "budget_band": budget_band(t["budget_no_tax"]),
            "duration_months": months(t["duration"], t["duration_unit"]),
            "deadline_date": t["deadline_date"],
            "last_update_date": (t["updated"] or "")[:10],
            "has_lots": "Yes" if t["has_lots"] else "No",
            "n_lots": len(t["lots"]),
            "price_weight_pct": price_weight(t),
            "has_tender_documents": "Yes" if {"pcap", "ppt"} & kinds else "No",
            "link": t["link"],
        })
        for r in t["results"]:
            base = t["budget_no_tax"] if not r["lot_id"] else lot_budget.get(r["lot_id"])
            disc = None
            if base and r["award_amount_no_tax"] and procedure in COMPETITIVE:
                d = 1 - r["award_amount_no_tax"] / base
                disc = round(d, 4) if -0.05 <= d <= 0.9 else None   # outliers = unit-price or data errors
            nif = r["winner_nif"] if r["winner_nif"] and "*" not in r["winner_nif"] else None
            results.append({
                "tender_id": t["id"],
                "lot_id": r["lot_id"] or "",
                "award_date": r["award_date"],
                "winner_name": (r["winner_name"] or "").strip() or None,
                "winner_nif": nif,
                "winner_is_sme": {"true": "Yes", "false": "No"}.get(str(r["sme_awarded"]).lower(), "Unknown"),
                "bids_received": r["received_tenders"],
                "competition_band": competition_band(r["received_tenders"]),
                "sme_bids_received": r["sme_received_tenders"],
                "lowest_bid_eur": r["lowest_bid"],
                "highest_bid_eur": r["highest_bid"],
                "budget_eur": base,
                "award_amount_eur": r["award_amount_no_tax"],
                "discount_pct": disc,
            })
    write(OUT / "tenders.csv", tenders)
    write(OUT / "results.csv", results)
    print(f"{len(tenders)} tenders, {len(results)} results -> {OUT}/")


if __name__ == "__main__":
    main()
