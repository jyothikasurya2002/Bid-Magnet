// Search beyond your matches: the backend's search_tenders() looks through every open
// tender (Spanish-aware: "aplicaciones" also finds "aplicación"). We only show the ones
// that aren't already in the matched feed.

export type SearchHit = {
  tender_id: string;
  title: string;
  buyer_name: string | null;
  region: string | null;
  status: string | null;
  budget_no_tax: number | string | null;
  deadline_date: string | null;
  rank: number;
};

export const MIN_QUERY = 3;

export function searchable(query: string) {
  return query.trim().length >= MIN_QUERY;
}

export function outsideMatches(hits: SearchHit[], matchedIds: Iterable<string>, limit = 15): SearchHit[] {
  const matched = new Set(matchedIds);
  const seen = new Set<string>();
  return hits
    .filter((hit) => !matched.has(hit.tender_id) && !seen.has(hit.tender_id) && seen.add(hit.tender_id))
    .slice(0, limit);
}
