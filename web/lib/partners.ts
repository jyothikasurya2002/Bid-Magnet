import { tidyName } from "./pipeline";

// Partner finder: companies that won contracts most similar to this tender, from the
// backend's partner_candidates(). Bidding together (as a UTE or with subcontracting)
// is how a young company covers experience or certification it doesn't have yet.

export type PartnerExample = { title: string; buyer: string | null; amount: number | string | null; date: string | null };

export type PartnerCandidate = {
  nif: string;
  name: string;
  similar_wins: number;
  best_similarity: number;
  regions: string[] | null;
  same_region: boolean;
  largest_similar_award: number | string | null;
  covers_experience: boolean | null;
  total_awards: number | null;
  is_sme: boolean | null;
  last_win: string | null;
  examples: PartnerExample[] | null;
};

export type PartnerCard = {
  key: string;
  name: string;
  tags: string[];
  detail: string;
  example: { title: string; buyer: string | null } | null;
};

const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

export function partnerCards(rows: PartnerCandidate[], limit = 5): PartnerCard[] {
  return rows.slice(0, limit).map((row) => {
    const tags = [
      row.same_region ? "Same region" : null,
      row.covers_experience ? "Proves experience" : null,
      row.is_sme ? "SME" : null,
    ].filter((tag): tag is string => Boolean(tag));
    const largest = Number(row.largest_similar_award);
    const detail = [
      `Won ${row.similar_wins} similar contract${row.similar_wins === 1 ? "" : "s"}`,
      largest > 0 ? `largest ${EURO.format(largest)}` : null,
      row.last_win ? `last ${MONTH.format(new Date(`${row.last_win.slice(0, 10)}T00:00:00Z`))}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const first = row.examples?.[0];
    return {
      key: row.nif,
      name: tidyName(row.name),
      tags,
      detail,
      example: first ? { title: first.title, buyer: first.buyer } : null,
    };
  });
}
