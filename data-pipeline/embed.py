"""Semantic embeddings for tenders and company profiles (free, runs locally).

    uv run --python 3.12 --with fastembed --with "psycopg[binary]" embed.py

Model: paraphrase-multilingual-MiniLM-L12-v2 (384 dims, Spanish/Catalan/Basque/English),
via fastembed (ONNX, no GPU, no API key). The same model exists for the browser as
Xenova/paraphrase-multilingual-MiniLM-L12-v2 (transformers.js) if the app ever needs to
embed a search query client-side.

Only rows whose text changed since the last run are embedded (md5 of the text is stored),
so the daily job is cheap. Stored as halfvec(384) (~0.8 KB per tender).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg
from fastembed import TextEmbedding

ROOT = Path(__file__).parent
MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
BATCH = 256

TENDER_TEXT = "t.title"  # titles are descriptive in Spanish procurement; buyer names add noise
COMPANY_TEXT = ("concat_ws('. ', c.description, array_to_string(c.keywords, ', '))")


def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def vec(v) -> str:
    return "[" + ",".join(f"{x:.5f}" for x in v) + "]"


def main() -> None:
    load_env()
    url = os.environ.get("DATABASE_URL") or sys.exit("Set DATABASE_URL")
    model = TextEmbedding(MODEL)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(f"""select t.id, {TENDER_TEXT}, md5({TENDER_TEXT}) from tenders t
                        left join tender_embeddings e on e.tender_id = t.id
                        where e.tender_id is null or e.text_md5 <> md5({TENDER_TEXT})""")
        todo = cur.fetchall()
        print(f"tenders to embed: {len(todo)}")
        for i in range(0, len(todo), BATCH):
            chunk = todo[i:i + BATCH]
            embs = list(model.embed([r[1] for r in chunk]))
            cur.executemany(
                "insert into tender_embeddings (tender_id, embedding, text_md5, model) "
                "values (%s, %s::extensions.halfvec, %s, %s) on conflict (tender_id) do update "
                "set embedding = excluded.embedding, text_md5 = excluded.text_md5, model = excluded.model",
                [(r[0], vec(e), r[2], MODEL) for r, e in zip(chunk, embs)])
            conn.commit()
            print(f"  {min(i + BATCH, len(todo))}/{len(todo)}", flush=True)

        cur.execute(f"""select c.id, {COMPANY_TEXT}, md5({COMPANY_TEXT}) from companies c
                        where c.embedding is null or c.embedding_md5 is distinct from md5({COMPANY_TEXT})""")
        companies = [r for r in cur.fetchall() if r[1]]
        for (cid, text, h), e in zip(companies, model.embed([r[1] for r in companies])):
            cur.execute("update companies set embedding = %s::extensions.halfvec, embedding_md5 = %s where id = %s",
                        [vec(e), h, cid])
        conn.commit()
        print(f"companies embedded: {len(companies)}")


if __name__ == "__main__":
    main()
