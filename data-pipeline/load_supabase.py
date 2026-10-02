"""Load out/tenders.jsonl into Supabase Postgres.

    export DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-eu-...pooler.supabase.com:5432/postgres"
    uv run --with "psycopg[binary]" load_supabase.py

DATABASE_URL: Supabase dashboard → Connect → Session pooler connection string.
A tender is only rewritten when the incoming version is newer (or with --force,
after a parser or schema change); its child rows are replaced with it.
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
BATCH = 200
FORCE = "--force" in sys.argv   # rewrite tenders even if unchanged (after a parser/schema change)

TENDER_COLS = [
    "id", "folder_id", "title", "link", "updated", "status", "status_label", "buyer_name", "buyer_nif",
    "buyer_dir3", "buyer_city", "buyer_hierarchy", "region", "contract_type", "contract_type_label",
    "procedure_code", "procedure_label", "budget_no_tax", "budget_with_tax", "estimated_value", "cpv_codes",
    "it_segment", "nuts_code", "duration", "duration_unit", "deadline_date", "deadline_time",
    "over_eu_threshold", "has_lots", "lots", "period_start", "period_end", "extra",
]
# Parsed fields that have no column of their own; kept small on purpose (no full JSON copy)
EXTRA_KEYS = ["entry_url", "buyer_type_code", "buyer_profile_url", "contract_subtype", "location",
              "urgency_code", "submission_method", "summary"]
CHILDREN = {
    "tender_criteria": ("criteria", ["lot_id", "type", "subtype", "description", "note", "weight"]),
    "tender_documents": ("documents", ["kind", "name", "doc_type", "notice_type", "url", "hash", "issue_date"]),
    "tender_results": ("results", ["lot_id", "result_code", "award_date", "start_date", "received_tenders",
                                   "sme_received_tenders", "lowest_bid", "highest_bid", "winner_nif",
                                   "winner_name", "award_amount_no_tax", "award_amount_with_tax",
                                   "sme_awarded", "contract_date"]),
    "tender_requirements": ("requirements", ["lot_id", "kind", "code", "description", "threshold"]),
}


def _bool(v):
    return None if v is None else str(v).lower() == "true"


def tender_row(t: dict) -> list:
    row = dict(t, region=region_of(t), lots=Jsonb(t["lots"]),
               extra=Jsonb({k: t.get(k) for k in EXTRA_KEYS if t.get(k) is not None}),
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
              f"where tenders.updated is null or excluded.updated {'>=' if FORCE else '>'} tenders.updated returning id")

    # Batched: executemany pipelines the statements, so a batch costs a few round trips
    # instead of several per tender. Each batch is committed, so an interrupted run keeps
    # its progress and a re-run skips nothing it shouldn't (upsert is newer-wins).
    written = 0
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        for start in range(0, len(tenders), BATCH):
            batch = tenders[start:start + BATCH]
            cur.executemany(upsert, [tender_row(t) for t in batch], returning=True)
            ids = []
            while True:
                row = cur.fetchone()
                if row:              # no row = stored version is newer; leave it alone
                    ids.append(row[0])
                if not cur.nextset():
                    break
            keep = set(ids)
            for table, (key, ccols) in CHILDREN.items():
                cur.execute(f"delete from {table} where tender_id = any(%s)", [ids])
                rows = [[t["id"]] + [child_value(c, i) for c in ccols]
                        for t in batch if t["id"] in keep for i in t[key]]
                if rows:
                    cur.executemany(
                        f"insert into {table} (tender_id, {', '.join(ccols)}) "
                        f"values ({', '.join(['%s'] * (len(ccols) + 1))})", rows)
            conn.commit()
            written += len(ids)
            print(f"  {min(start + BATCH, len(tenders))}/{len(tenders)} processed, {written} written", flush=True)
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

        # Full bid results (bid_results.py): replace per tender
        loaded = 0
        for path in sorted((ROOT / "out" / "bids").glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            tid = data["tender_id"]
            cur.execute("select 1 from tenders where id = %s", [tid])
            if cur.fetchone() is None:
                print(f"  skip bids {tid}: tender not in database")
                continue
            cur.execute("delete from tender_bids where tender_id = %s", [tid])
            cur.executemany(
                "insert into tender_bids (tender_id, lot_id, bidder_name, bidder_nif, offer_no_tax, tech_score, "
                "formula_score, price_score, total_score, rank, status, exclusion_reason, source_doc, source_page, "
                "source_quote, verified) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                [[tid, b.get("lot_id"), b["bidder_name"], b.get("bidder_nif"), b.get("offer_no_tax"), b.get("tech_score"),
                  b.get("formula_score"), b.get("price_score"), b.get("total_score"), b.get("rank"), b["status"],
                  b.get("exclusion_reason"), b.get("doc"), b.get("page"), b.get("quote"), b.get("verified")]
                 for b in data["bids"]])
            cur.execute("insert into tender_bid_reports (tender_id, output) values (%s, %s) "
                        "on conflict (tender_id) do update set output = excluded.output, created_at = now()",
                        [tid, Jsonb({k: v for k, v in data.items() if k != "bids"})])
            loaded += 1
        conn.commit()
        print(f"loaded bid results for {loaded} tenders")

        # Materialized views from backend.sql: recompute them from the new data
        for view in ("buyer_stats", "competitor_stats"):
            cur.execute("select 1 from pg_matviews where matviewname = %s", [view])
            if cur.fetchone():
                cur.execute(f"refresh materialized view {view}")
                conn.commit()
                print(f"refreshed {view}")


if __name__ == "__main__":
    main()
