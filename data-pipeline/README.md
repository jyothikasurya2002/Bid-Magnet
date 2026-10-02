# BidMagnet data pipeline

Pulls Spanish public tenders from PLACSP (the national procurement platform), keeps the IT ones, and loads them into Supabase.

```
PLACSP Atom/XML ──► placsp_fetch.py ──► raw/ ──► build_dataset.py ──► out/*.csv, tenders.jsonl ──► load_supabase.py ──► Supabase
                         └── docs ──► raw/docs/<tender_id>/*.pdf  (PCAP/PPT for the Claude extraction step)
```

## Quick start

Requires Python 3.9 or newer. The fetch and build scripts use the standard library only.

```bash
# 1. Get data: a monthly zip (slow server, 10–30 min) or just the newest live pages (~1–2 min each)
python placsp_fetch.py month 202609
python placsp_fetch.py live --pages 2

# 2. Parse, keep IT, dedupe → out/
python build_dataset.py raw/placsp_202609.zip            # core IT only (CPV 72*, 48*)
python build_dataset.py raw/live --segments all          # + hardware & telecom

# 3. PDFs for tenders still open
python placsp_fetch.py docs --open-only --limit 50

# 4. Load into Supabase (run schema.sql in the SQL editor first)
export DATABASE_URL="postgresql://..."    # Supabase → Connect → Session pooler
uv run --with "psycopg[binary]" load_supabase.py
```

## Outputs (`out/`)

| File | One row per | Key fields |
|---|---|---|
| `tenders.csv` | tender (latest version) | title, status, buyer, budget, CPVs, deadline, region, price weight |
| `criteria.csv` | award criterion | description, weight, OBJ (formula) / SUBJ (judgement), subtype 1 = price |
| `documents.csv` | document link | kind: `pcap` (admin terms), `ppt` (tech specs), `notice` (award resolutions…), url |
| `results.csv` | award (per lot) | winner name + NIF, bidders received, lowest/highest bid, award amount |
| `requirements.csv` | requirement | solvency (technical/financial), declarations, classification |
| `stats.md` | — | coverage numbers |
| `tenders.jsonl` | tender | full nested record (what gets loaded) |

## Things worth knowing

- **Certificates.** PLACSP's HTTPS certificate is issued by FNMT (the Spanish state certificate authority), which isn't in the default macOS or Ubuntu trust stores. `certs/fnmt_chain.pem` (FNMT "AC SERVIDORES SEGUROS TIPO2" plus its root) is added on top of the system store.
  - Root SHA-256: check against FNMT's published fingerprint before relying on it in production.
- **Versions.** Each status change (PUB → EV → ADJ → RES) is published as a new entry with the same id. We keep the newest `updated` per id, and the loader never overwrites a newer row with an older one.
- **Status codes.**

  | Code | Meaning |
  |---|---|
  | `PUB` | Open for bids |
  | `EV` | Under evaluation |
  | `ADJ` | Awarded |
  | `RES` | Resolved / formalised |
  | `PRE` | Prior notice |
  | `ANUL` | Cancelled |
- **IT filter.** Defined in `IT_CPV_PREFIXES` in `placsp_parse.py`.
  - `core` = 72\* (IT services) and 48\* (software).
  - Some tenders carry an IT code as a secondary code (e.g. data-protection services), so expect some noise. Semantic matching cleans this up later.
- **Data already in the XML (no PDF needed):**
  - award criteria with weights
  - solvency requirements
  - winner and tax ID
  - number of bids received
  - lowest and highest bid
  - award amount

  The PDFs are needed for the full requirement checklist, the price formula and the abnormally-low-bid threshold.
- **Re-loading a tender replaces its document rows.** Re-run any Storage upload or extraction linking for that tender afterwards.
- **Daily job.** `.github/workflows/daily-ingest.yml` at the repo root. It needs the `DATABASE_URL` repo secret: GitHub → Settings → Secrets and variables → Actions. Use the Session pooler URL; the direct `db.*.supabase.co` host is IPv6-only.
- **Extraction without an API key.** Checklists in `out/extractions/` can be written by hand or with Claude Code, then checked with `uv run --with pymupdf extract_tender.py <id> --verify`.
