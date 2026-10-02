"""Load out/tenders.jsonl into Supabase Postgres.

    export DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-eu-...pooler.supabase.com:5432/postgres"
    uv run --with "psycopg[binary]" load_supabase.py

DATABASE_URL: Supabase dashboard → Connect → Session pooler connection string.
A tender is only overwritten when the incoming version is newer; its child rows
(criteria, documents, results, requirements) are replaced with it.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from build_dataset import region_of

ROOT = Path(__file__).parent

TENDER_COLS = [
    "id", "folder_id", "title", "link", "updated", "status", "status_label", "buyer_name", "buyer_nif",
    "buyer_dir3", "buyer_city", "buyer_hierarchy", "region", "contract_type", "contract_type_label",
    "procedure_code", "procedure_label", "budget_no_tax", "budget_with_tax", "estimated_value", "cpv_codes",
    "it_segment", "nuts_code", "duration", "duration_unit", "deadline_date", "deadline_time",
    "over_eu_threshold", "has_lots", "lots", "raw",
]
CHILDREN = {
    "tender_criteria": ("criteria", ["lot_id", "type", "subtype", "description", "note", "weight"]),
    "tender_documents": ("documents", ["kind", "name", "doc_type", "notice_type", "url", "hash", "issue_date"]),
    "tender_results": ("results", ["lot_id", "result_code", "award_date", "received_tenders",
                                   "sme_received_tenders", "lowest_bid", "highest_bid", "winner_nif",
                                   "winner_name", "award_amount_no_tax", "award_amount_with_tax",
                                   "sme_awarded", "contract_date"]),
    "tender_requirements": ("requirements", ["lot_id", "kind", "code", "description", "threshold"]),
}


def _bool(v):
    return None if v is None else str(v).lower() == "true"


def tender_row(t: dict) -> list:
    row = dict(t, region=region_of(t), lots=Jsonb(t["lots"]), raw=Jsonb(t),
               over_eu_threshold=_bool(t["over_eu_threshold"]))
    return [row.get(c) for c in TENDER_COLS]


def child_value(col: str, item: dict):
    v = item.get(col)
    return _bool(v) if col == "sme_awarded" else v


def main() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("Set DATABASE_URL (Supabase → Connect → Session pooler).")
    tenders = [json.loads(l) for l in (ROOT / "out" / "tenders.jsonl").open(encoding="utf-8")]

    cols = ", ".join(TENDER_COLS)
    placeholders = ", ".join(["%s"] * len(TENDER_COLS))
    updates = ", ".join(f"{c} = excluded.{c}" for c in TENDER_COLS if c != "id")
    upsert = (f"insert into tenders ({cols}) values ({placeholders}) "
              f"on conflict (id) do update set {updates}, ingested_at = now() "
              f"where tenders.updated is null or excluded.updated >= tenders.updated returning id")

    written = 0
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        for t in tenders:
            cur.execute(upsert, tender_row(t))
            if cur.fetchone() is None:   # stored version is newer; leave it alone
                continue
            written += 1
            for table, (key, ccols) in CHILDREN.items():
                cur.execute(f"delete from {table} where tender_id = %s", [t["id"]])
                rows = [[t["id"]] + [child_value(c, i) for c in ccols] for i in t[key]]
                if rows:
                    cur.executemany(
                        f"insert into {table} (tender_id, {', '.join(ccols)}) "
                        f"values ({', '.join(['%s'] * (len(ccols) + 1))})", rows)
        conn.commit()
        print(f"upserted {written} of {len(tenders)} tenders")

        # Checklists from extract_tender.py (latest file per tender replaces the stored one)
        loaded = 0
        for path in sorted((ROOT / "out" / "extractions").glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            tid = path.stem
            cur.execute("select 1 from tenders where id = %s", [tid])
            if cur.fetchone() is None:
                print(f"  skip extraction {tid}: tender not in database")
                continue
            cur.execute("delete from tender_extractions where tender_id = %s", [tid])
            cur.execute("insert into tender_extractions (tender_id, model, output) values (%s, %s, %s)",
                        [tid, data.get("_meta", {}).get("model", "claude"), Jsonb(data)])
            loaded += 1
        conn.commit()
        print(f"loaded {loaded} extractions")


if __name__ == "__main__":
    main()
