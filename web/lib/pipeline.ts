import { durationLabel, sourceLabel, type Decision } from "./discover";
import type { MatchReason } from "./types";

// Evidence for the bid / no-bid view: the buyer's past prices and who wins this kind of work.

// No real price competition in these, so their "discounts" mean nothing (same rule as buyer_stats).
const NON_COMPETITIVE = new Set([
  "Negociado sin publicidad",
  "Derivado de acuerdo marco",
  "Basado en sistema dinámico de adquisición",
]);

export type AwardRow = {
  tender_id: string;
  lot_id: string | null;
  award_date: string | null;
  award_amount_no_tax: number | string | null;
  winner_name: string | null;
  tenders: { title: string; procedure_label: string | null; budget_no_tax: number | string | null } | null;
};

export type DiscountPoint = { date: string; discount: number; title: string; winner: string | null; tender_id: string };

// Winning discount per award (whole-contract awards only, where the budget is the base).
export function awardDiscounts(rows: AwardRow[], limit = 12): DiscountPoint[] {
  const seen = new Set<string>();
  const points: DiscountPoint[] = [];
  for (const row of rows) {
    const tender = row.tenders;
    if (!tender || row.lot_id || !row.award_date || seen.has(row.tender_id)) continue;
    if (tender.procedure_label && NON_COMPETITIVE.has(tender.procedure_label)) continue;
    const budget = Number(tender.budget_no_tax);
    const award = Number(row.award_amount_no_tax);
    if (!(budget > 0) || !(award > 0)) continue;
    const discount = 1 - award / budget;
    if (discount < -0.05 || discount > 0.9) continue;
    seen.add(row.tender_id);
    points.push({ date: row.award_date.slice(0, 10), discount, title: tender.title, winner: row.winner_name, tender_id: row.tender_id });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type SimilarAward = {
  tender_id: string;
  title: string;
  buyer_name: string | null;
  winner_name: string | null;
  winner_nif: string | null;
  discount: number | string | null;
  received_tenders: number | null;
  award_date: string | null;
  similarity: number;
};

export type Rival = { key: string; name: string; similarWins: number; buyerWins: number };

const companyKey = (nif: string | null, name: string) => (nif && nif !== "-" ? nif.toUpperCase() : name.toLowerCase().trim());

// Who wins work like this (similar contracts anywhere) and who wins at this buyer.
export function likelyRivals(
  similar: SimilarAward[],
  topWinners: Array<{ name: string; nif: string | null; wins: number }>,
  ownNif: string | null,
  limit = 5,
): Rival[] {
  const rivals = new Map<string, Rival>();
  const own = ownNif ? ownNif.toUpperCase() : null;
  const add = (nif: string | null, name: string, similarWins: number, buyerWins: number) => {
    const key = companyKey(nif, name);
    if (own && key === own) return;
    const rival = rivals.get(key) ?? { key, name, similarWins: 0, buyerWins: 0 };
    rival.similarWins += similarWins;
    rival.buyerWins += buyerWins;
    rivals.set(key, rival);
  };
  for (const award of similar) if (award.winner_name) add(award.winner_nif, award.winner_name, 1, 0);
  for (const winner of topWinners) add(winner.nif, winner.name, 0, winner.wins);
  return [...rivals.values()]
    .sort((a, b) => b.similarWins + b.buyerWins - (a.similarWins + a.buyerWins) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Spanish company names arrive in every capitalisation; show them calmly.
export function tidyName(name: string) {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s(.,-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/\b(S\.?l\.?u?|S\.?a\.?u?|Slp|Ute)\b\.?/gi, (match) => match.toUpperCase());
}

export type DecisionData = {
  companyId: string;
  tender: {
    id: string;
    title: string;
    buyer: string | null;
    region: string | null;
    budget: number | null;
    deadline: string | null;
    deadlineTime: string | null;
    procedure: string | null;
    duration: string | null;
    platform: string;
    link: string | null;
  };
  decision: Decision | null;
  score: number | null;
  reasons: MatchReason[];
  buyer: {
    itTenders: number;
    awards: number;
    medianBidders: number | null;
    medianDiscount: number | null;
    discountSample: number;
  } | null;
  previous: {
    title: string;
    winner: string | null;
    date: string | null;
    discount: number | null;
    bidders: number | null;
  } | null;
  rivals: Rival[];
  similarCount: number;
  discounts: DiscountPoint[];
  discountScope: "buyer" | "similar";
  medianDiscount: number | null;
  pricePoints: number | null;
  judgementPoints: number | null;
  priceNote: string | null;
  abnormallyLow: string | null;
  documents: Array<{ kind: string; name: string; url: string }>;
};

export type BuyerStats = {
  it_tenders: number | string;
  awards: number | string;
  median_bidders: number | null;
  median_discount: number | null;
  discount_sample: number | string;
  top_winners: Array<{ name: string; nif: string | null; wins: number }>;
};

export type Criterion = { type: string | null; subtype: string | null; weight: number | string | null; lot_id: string | null };

export type DecisionInput = {
  companyId: string;
  companyNif: string | null;
  tender: {
    id: string;
    title: string;
    buyer_name: string | null;
    region: string | null;
    budget_no_tax: number | string | null;
    deadline_date: string | null;
    deadline_time: string | null;
    procedure_label: string | null;
    link: string | null;
    source: string | null;
    duration: number | string | null;
    duration_unit: string | null;
  };
  decision: Decision | null;
  match: { score: number; reasons: MatchReason[] } | null;
  buyer: BuyerStats | null;
  awards: AwardRow[];
  similar: SimilarAward[];
  criteria: Criterion[];
  price: { formula_explained_en?: string; abnormally_low_rule?: string } | null;
  documents: Array<{ kind: string; name: string; url: string }>;
};

// Everything the bid / no-bid view shows, from the raw rows.
export function assembleDecision(input: DecisionInput): DecisionData {
  const { tender } = input;
  const similar = input.similar.filter((row) => row.tender_id !== tender.id);

  // Price points: criteria flagged as price (subtype 1), whole contract when given.
  const whole = input.criteria.some((row) => !row.lot_id) ? input.criteria.filter((row) => !row.lot_id) : input.criteria;
  const sum = (rows: Criterion[]) => Math.round(rows.reduce((total, row) => total + Number(row.weight || 0), 0));
  const pricePoints = sum(whole.filter((row) => row.subtype === "1"));
  const judgementPoints = sum(whole.filter((row) => row.type === "SUBJ"));

  // The buyer's own awards when there are enough, otherwise similar contracts elsewhere.
  const buyerPoints = awardDiscounts(input.awards);
  const similarPoints = similar
    .filter((row) => row.discount !== null && row.award_date)
    .map((row) => ({
      date: row.award_date!.slice(0, 10),
      discount: Number(row.discount),
      title: row.title,
      winner: row.winner_name,
      tender_id: row.tender_id,
    }))
    .filter((point) => point.discount >= -0.05 && point.discount <= 0.9)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12);
  const useBuyer = buyerPoints.length >= 3;
  const discounts = useBuyer ? buyerPoints : similarPoints;
  const sameBuyer = similar.find((row) => row.buyer_name === tender.buyer_name);
  const stats = input.buyer;

  return {
    companyId: input.companyId,
    tender: {
      id: tender.id,
      title: tender.title,
      buyer: tender.buyer_name,
      region: tender.region,
      budget: Number(tender.budget_no_tax) > 0 ? Number(tender.budget_no_tax) : null,
      deadline: tender.deadline_date,
      deadlineTime: tender.deadline_time,
      procedure: tender.procedure_label,
      duration: durationLabel(tender.duration === null ? null : Number(tender.duration), tender.duration_unit),
      platform: sourceLabel(tender.source, tender.link, tender.region),
      link: tender.link,
    },
    decision: input.decision,
    score: input.match?.score ?? null,
    reasons: input.match?.reasons ?? [],
    buyer: stats
      ? {
          itTenders: Number(stats.it_tenders),
          awards: Number(stats.awards),
          medianBidders: stats.median_bidders,
          medianDiscount: stats.median_discount,
          discountSample: Number(stats.discount_sample),
        }
      : null,
    previous: sameBuyer
      ? {
          title: sameBuyer.title,
          winner: sameBuyer.winner_name,
          date: sameBuyer.award_date,
          discount: sameBuyer.discount === null ? null : Number(sameBuyer.discount),
          bidders: sameBuyer.received_tenders,
        }
      : null,
    rivals: likelyRivals(similar.slice(0, 20), stats?.top_winners ?? [], input.companyNif),
    similarCount: Math.min(20, similar.length),
    discounts,
    discountScope: useBuyer ? "buyer" : "similar",
    medianDiscount: median(discounts.map((point) => point.discount)),
    pricePoints: pricePoints || null,
    judgementPoints: judgementPoints || null,
    priceNote: input.price?.formula_explained_en ?? null,
    abnormallyLow: input.price?.abnormally_low_rule ?? null,
    documents: input.documents,
  };
}
