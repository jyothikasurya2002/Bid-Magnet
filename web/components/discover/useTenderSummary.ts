"use client";

import { useEffect, useState } from "react";
import type { TenderSummary } from "@/lib/tender-summary";
import { readJson } from "@/components/company/useResearchJob";

export type SummaryResult = { summary: TenderSummary } | { error: string };

// One request per tender per page load, shared by the preview pane and the swipe cards.
const requests = new Map<string, Promise<SummaryResult>>();

function fetchSummary(id: string) {
  if (!requests.has(id)) {
    requests.set(
      id,
      fetch(`/api/tenders/${encodeURIComponent(id)}/summary`)
        .then((response) => readJson<TenderSummary>(response))
        .then((summary) => ({ summary }))
        .catch((error: unknown) => {
          requests.delete(id); // allow a retry next time it's opened
          return { error: error instanceof Error ? error.message : "The summary failed." };
        }),
    );
  }
  return requests.get(id)!;
}

export function useTenderSummary(id: string | null) {
  const [results, setResults] = useState<Record<string, SummaryResult>>({});

  useEffect(() => {
    if (!id || results[id]) return;
    let active = true;
    void fetchSummary(id).then((result) => {
      if (active) setResults((current) => ({ ...current, [id]: result }));
    });
    return () => {
      active = false;
    };
  }, [id, results]);

  return id ? results[id] ?? null : null;
}
