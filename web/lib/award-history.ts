import { canonicalRegion } from "./profile";
import { awardDiscounts, median, type AwardRow } from "./pipeline";
import type { CompanyProfile, ImportSuggestion } from "./types";

// A company's own public contract awards, found by its tax ID (NIF) in the award
// records we load from PLACSP and the regional platforms. No AI involved.

export type CompanyAward = {
  tender_id: string;
  lot_id: string | null;
  award_date: string | null;
  award_amount_no_tax: number | string | null;
  winner_name: string | null;
  tenders: {
    title: string;
    procedure_label: string | null;
    budget_no_tax: number | string | null;
    cpv_codes: string[] | null;
    region: string | null;
    buyer_nif: string | null;
    buyer_name: string | null;
    duration: number | string | null;
    duration_unit: string | null;
  } | null;
};

export type AwardHistory = {
  count: number; // awards, counted per lot
  tenders: number;
  total: number;
  sectors: Array<{ prefix: string; count: number }>;
  regions: Array<{ region: string; count: number }>;
  size: { low: number; typical: number; high: number } | null;
  buyers: Array<{ key: string; name: string; count: number; last: string | null }>;
  discount: { median: number; sample: number } | null;
};

export const AWARD_SOURCE = "Public award records, Jan–Sep 2026";

export const COMPANY_NIF = /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/;

export function normalizeNif(nif: string) {
  return nif.replace(/[\s.-]/g, "").toUpperCase();
}

// The award records sometimes write the NIF with a dash after the letter.
export function nifVariants(nif: string) {
  const clean = normalizeNif(nif);
  return [clean, `${clean[0]}-${clean.slice(1)}`];
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// One buyer, by NIF when known, else by name.
export function buyerKey(nif: string | null, name: string | null) {
  return nif ? `nif:${normalizeNif(nif)}` : name ? `name:${fold(name)}` : null;
}

// "72267000" -> "7226": the class level, which is how most profile sector codes are stored.
export function cpvPrefix(code: string) {
  return code.slice(0, 4);
}

// IT divisions only (equipment 302, telecom equipment 324, software 48, repair 503,
// telecom services 642, IT services 72), and specific enough to be useful: "7200"
// (all IT services) would match everything.
const IT_ROOTS = ["302", "324", "48", "503", "642", "72"];
export function isUsefulSector(prefix: string) {
  return prefix.length === 4 && !prefix.endsWith("00") && IT_ROOTS.some((root) => prefix.startsWith(root));
}

function niceRound(value: number, direction: "down" | "up") {
  const step = value >= 1_000_000 ? 100_000 : value >= 100_000 ? 10_000 : 1_000;
  return (direction === "down" ? Math.floor(value / step) : Math.ceil(value / step)) * step;
}

function quantile(sorted: number[], q: number) {
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

export function summarizeAwards(awards: CompanyAward[]): AwardHistory {
  const tenders = new Set(awards.map((award) => award.tender_id));

  // Count each tender once per sector and region, not once per lot.
  const sectorTenders = new Map<string, Set<string>>();
  const regionTenders = new Map<string, Set<string>>();
  const buyers = new Map<string, { name: string; tenders: Set<string>; last: string | null }>();
  for (const award of awards) {
    const tender = award.tenders;
    if (!tender) continue;
    for (const prefix of new Set((tender.cpv_codes || []).map(cpvPrefix).filter(isUsefulSector))) {
      (sectorTenders.get(prefix) ?? sectorTenders.set(prefix, new Set()).get(prefix)!).add(award.tender_id);
    }
    if (tender.region) {
      (regionTenders.get(tender.region) ?? regionTenders.set(tender.region, new Set()).get(tender.region)!).add(award.tender_id);
    }
    const key = buyerKey(tender.buyer_nif, tender.buyer_name);
    if (key) {
      const entry = buyers.get(key) ?? { name: tender.buyer_name || "", tenders: new Set<string>(), last: null };
      entry.tenders.add(award.tender_id);
      if (award.award_date && (!entry.last || award.award_date > entry.last)) entry.last = award.award_date;
      buyers.set(key, entry);
    }
  }

  // Ignore token amounts (framework lots are often awarded at €0 or a few euros).
  const amounts = awards
    .map((award) => Number(award.award_amount_no_tax))
    .filter((amount) => amount >= 1_000)
    .sort((a, b) => a - b);

  const discounts = awardDiscounts(awards as unknown as AwardRow[], 1_000).map((point) => point.discount);
  const medianDiscount = median(discounts);

  return {
    count: awards.length,
    tenders: tenders.size,
    total: amounts.reduce((sum, amount) => sum + amount, 0),
    sectors: [...sectorTenders.entries()]
      .map(([prefix, set]) => ({ prefix, count: set.size }))
      .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix)),
    regions: [...regionTenders.entries()]
      .map(([region, set]) => ({ region, count: set.size }))
      .sort((a, b) => b.count - a.count),
    size:
      amounts.length >= 3
        ? {
            low: niceRound(quantile(amounts, 0.2), "down"),
            typical: Math.round(quantile(amounts, 0.5)),
            high: niceRound(quantile(amounts, 0.8), "up"),
          }
        : null,
    buyers: [...buyers.entries()]
      .map(([key, entry]) => ({ key, name: entry.name, count: entry.tenders.size, last: entry.last }))
      .sort((a, b) => b.count - a.count),
    discount: medianDiscount !== null ? { median: medianDiscount, sample: discounts.length } : null,
  };
}

const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

function suggestion(
  field: ImportSuggestion["field"],
  values: string[],
  quote: string,
  explanation: string,
  valueText = values.join(", "),
): ImportSuggestion {
  return {
    field,
    value_text: valueText,
    values,
    evidence_state: "direct_source",
    source_url: "",
    source_title: AWARD_SOURCE,
    source_quote: quote,
    explanation,
    verified: true,
  };
}

// Profile facts the award record backs up: sectors and regions with at least two
// won tenders, and a contract size range from the middle of their awards.
export function historySuggestions(history: AwardHistory, company: CompanyProfile): ImportSuggestion[] {
  if (!history.tenders) return [];
  const suggestions: ImportSuggestion[] = [];
  const covered = (prefix: string) => company.cpv_prefixes.some((existing) => prefix.startsWith(existing));

  const sectors = history.sectors.filter((sector) => sector.count >= 2 && !covered(sector.prefix)).slice(0, 8);
  if (sectors.length) {
    suggestions.push(
      suggestion(
        "cpv_prefixes",
        sectors.map((sector) => sector.prefix),
        sectors.map((sector) => `${sector.prefix}: ${sector.count} won`).join(" · "),
        `Sector codes on contracts you won (${history.tenders} tenders).`,
      ),
    );
  }

  const regions = history.regions
    .filter((entry) => entry.count >= 2 && entry.region !== "Nacional")
    .map((entry) => ({ ...entry, region: canonicalRegion(entry.region) }))
    .filter((entry): entry is { region: string; count: number } => Boolean(entry.region) && !company.regions.includes(entry.region!));
  if (regions.length) {
    suggestions.push(
      suggestion(
        "regions",
        regions.map((entry) => entry.region),
        regions.map((entry) => `${entry.region}: ${entry.count} won`).join(" · "),
        "Regions where you've won contracts.",
      ),
    );
  }

  if (history.size && company.min_budget === null && company.max_budget === null) {
    const { low, typical, high } = history.size;
    suggestions.push(
      suggestion("min_budget", [], `Typical award ${EURO.format(typical)}`, "The lower end of what you usually win.", String(low)),
      suggestion("max_budget", [], `Typical award ${EURO.format(typical)}`, "The upper end of what you usually win.", String(high)),
    );
  }
  return suggestions;
}

// Experience check: the usual technical-solvency rule asks for similar work worth
// at least 70% of the contract's yearly value in your best year.
export function experienceCheck(
  awards: CompanyAward[],
  tender: { cpv_codes: string[] | null; budget: number | null; duration: number | null; durationUnit: string | null },
) {
  const prefixes = new Set((tender.cpv_codes || []).map(cpvPrefix).filter((prefix) => !prefix.endsWith("00")));
  if (!prefixes.size) return null;
  const years = (value: number | null, unit: string | null) =>
    !value || !unit ? 1 : unit === "ANN" ? value : unit === "MON" ? value / 12 : unit === "DAY" ? value / 365 : 1;

  const similar = awards.filter((award) =>
    (award.tenders?.cpv_codes || []).some((code) => prefixes.has(cpvPrefix(code))),
  );
  const yearly = similar.reduce((sum, award) => {
    const amount = Number(award.award_amount_no_tax) || 0;
    return sum + amount / Math.max(1, years(Number(award.tenders?.duration) || null, award.tenders?.duration_unit ?? null));
  }, 0);
  const needed = tender.budget ? Math.round((0.7 * tender.budget) / Math.max(1, years(tender.duration, tender.durationUnit))) : null;

  return {
    similar: similar.length,
    examples: similar.slice(0, 3).map((award) => ({ title: award.tenders?.title ?? "", amount: Number(award.award_amount_no_tax) || null })),
    yearly: Math.round(yearly),
    needed,
    meets: needed !== null ? yearly >= needed : null,
  };
}

// Fit-score bonus for buyers you've already won from. match_tenders can't see a company's
// award history, so it's added here, the same way everywhere the score is shown.
export const KNOWN_BUYER_POINTS = 5;

export function withTrackRecord<T extends { score: number | null; reasons: Array<{ type: "ok" | "warn" | "gap"; points: number; text: string }> }>(
  row: T,
  buyer: { nif: string | null; name: string | null },
  history: AwardHistory | null,
): T {
  if (row.score === null || !history?.buyers.length) return row;
  const key = buyerKey(buyer.nif, buyer.name);
  const nameKey = buyerKey(null, buyer.name);
  const known = history.buyers.find((entry) => entry.key === key || entry.key === nameKey);
  if (!known) return row;
  return {
    ...row,
    score: Math.min(100, row.score + KNOWN_BUYER_POINTS),
    reasons: [
      ...row.reasons,
      {
        type: "ok",
        points: KNOWN_BUYER_POINTS,
        text: `You've won ${known.count} contract${known.count === 1 ? "" : "s"} from this buyer`,
      },
    ],
  };
}

export type TrackRecord = {
  tenders: number; // contracts won in our records
  atBuyer: { count: number; last: string | null } | null;
  discount: { median: number; sample: number } | null;
  experience: ReturnType<typeof experienceCheck>;
};

// What your own awards say about this tender, for the bid / no-bid page.
export function trackRecordFor(
  awards: CompanyAward[],
  tender: {
    buyer_nif: string | null;
    buyer_name: string | null;
    cpv_codes: string[] | null;
    budget: number | null;
    duration: number | null;
    durationUnit: string | null;
  },
): TrackRecord {
  const history = summarizeAwards(awards);
  const key = buyerKey(tender.buyer_nif, tender.buyer_name);
  const nameKey = buyerKey(null, tender.buyer_name);
  const atBuyer = history.buyers.find((entry) => entry.key === key || entry.key === nameKey) ?? null;
  return {
    tenders: history.tenders,
    atBuyer: atBuyer ? { count: atBuyer.count, last: atBuyer.last } : null,
    discount: history.discount,
    experience: experienceCheck(awards, tender),
  };
}
