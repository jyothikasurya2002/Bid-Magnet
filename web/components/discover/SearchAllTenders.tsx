"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { closesLabel, euroShort } from "@/lib/discover";
import { outsideMatches, searchable, type SearchHit } from "@/lib/search-all";
import { createClient } from "@/lib/supabase/client";

// Under the matched feed: open tenders that match the search words but not the profile.
export function SearchAllTenders({ query, matchedIds }: { query: string; matchedIds: string[] }) {
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const q = query.trim();
  const active = searchable(q);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setState("loading");
      const { data, error } = await createClient().rpc("search_tenders", { q, only_open: true, p_limit: 40 });
      if (cancelled) return;
      if (error) {
        setState("error");
        return;
      }
      setHits((data || []) as SearchHit[]);
      setState("done");
    }, 350); // wait for the user to stop typing
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, active]);

  const extra = useMemo(() => outsideMatches(hits, matchedIds), [hits, matchedIds]);

  if (!active || state === "idle") return null;
  return (
    <section className="search-all" aria-live="polite">
      <h3 className="search-all-title">
        More open tenders matching “{q}”
        <span className="search-all-aside">outside your profile matches · all of Spain</span>
      </h3>
      {state === "loading" ? <p className="dec-muted">Searching all open tenders…</p> : null}
      {state === "error" ? <p className="dec-muted">Search is unavailable right now.</p> : null}
      {state === "done" && !extra.length ? <p className="dec-muted">No other open tenders match these words.</p> : null}
      {extra.length ? (
        <ul className="search-all-list">
          {extra.map((hit) => (
            <li key={hit.tender_id}>
              <Link href={`/pipeline/${hit.tender_id}`} className="search-all-row">
                <span className="search-all-name" lang="es">
                  {hit.title}
                </span>
                <span className="search-all-meta">
                  {[
                    hit.buyer_name,
                    hit.region,
                    Number(hit.budget_no_tax) > 0 ? euroShort(Number(hit.budget_no_tax)) : null,
                    hit.deadline_date ? closesLabel(hit.deadline_date) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
