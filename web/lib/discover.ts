// Formatting and filtering for the Discover feed.

export type Decision = "go" | "no_go" | "watch";

export type FeedTender = {
  tender_id: string;
  title: string;
  buyer_name: string | null;
  region: string | null;
  budget_no_tax: number | null;
  deadline_date: string | null;
  deadline_time: string | null;
  procedure_label: string | null;
  score: number | null; // null for renewals and early signals (no fit score)
  reasons: Array<{ type: "ok" | "warn" | "gap"; points: number; text: string }>;
  has_checklist: boolean;
  link: string | null;
  source: string;
  duration: number | null;
  duration_unit: string | null;
  kind: "open" | "renewal" | "signal";
  // renewals only
  incumbent?: string | null;
  estimated_end?: string | null;
};

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Monday-to-Friday days from today until the date (public holidays not counted).
export function businessDaysUntil(isoDate: string, today = new Date()) {
  const end = startOfDay(new Date(`${isoDate}T00:00:00`));
  let day = startOfDay(today);
  if (end <= day) return 0;
  let count = 0;
  while (day < end) {
    day = new Date(day.getTime() + DAY);
    const weekday = day.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return count;
}

const PLATFORM_HOSTS: Array<[RegExp, string]> = [
  [/euskadi\.eus/, "KontratazioA"],
  [/contractaciopublica\.(cat|gencat)|gencat\.cat/, "Catalonia PSCP"],
  [/navarra\.es/, "Navarra"],
  [/madrid\.org/, "Madrid"],
  [/juntadeandalucia\.es/, "Andalucía"],
  [/xunta\.gal/, "Galicia"],
  [/contrataciondelestado\.es|contrataciondelsectorpublico\.gob\.es/, "PLACSP"],
];

// Which platform publishes the tender, from its link.
export function sourceLabel(source: string | null, link: string | null, region: string | null) {
  const hit = link ? PLATFORM_HOSTS.find(([pattern]) => pattern.test(link)) : undefined;
  if (hit) return hit[1];
  return source === "regional" ? region || "Regional" : "PLACSP";
}

export function durationLabel(duration: number | null, unit: string | null) {
  if (!duration || !unit) return null;
  const value = Number(duration);
  const plural = (word: string) => `${value} ${word}${value === 1 ? "" : "s"}`;
  if (unit === "ANN") return plural("year");
  if (unit === "MON") return value % 12 === 0 ? `${value / 12} year${value === 12 ? "" : "s"}` : plural("month");
  if (unit === "DAY") return plural("day");
  return null;
}

const EURO_SHORT = new Intl.NumberFormat("en-IE", { maximumFractionDigits: 1 });
export function euroShort(value: number | null) {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `€${EURO_SHORT.format(value / 1_000_000)}M`;
  if (value >= 1_000) return `€${Math.round(value / 1_000)}k`;
  return `€${Math.round(value)}`;
}

// Award weighting: points scored by formula (price and other automatic criteria) vs by judgement.
export function weighting(criteria: Array<{ type: string | null; weight: number | null; lot_id?: string | null }>) {
  const whole = criteria.some((item) => !item.lot_id) ? criteria.filter((item) => !item.lot_id) : criteria;
  const sum = (type: string) =>
    whole.filter((item) => item.type === type).reduce((total, item) => total + Number(item.weight || 0), 0);
  const formula = sum("OBJ");
  const judgement = sum("SUBJ");
  if (!formula && !judgement) return null;
  return { formula: Math.round(formula), judgement: Math.round(judgement) };
}

export const isFramework = (title: string) => /acuerdo[s]? marco|framework agreement/i.test(title);

export type Filters = {
  minFit: boolean;
  closingSoon: boolean;
  hideFrameworks: boolean;
};

export function applyFilters(tenders: FeedTender[], filters: Filters, today = new Date()) {
  return tenders.filter((tender) => {
    if (filters.minFit && tender.score !== null && tender.score < 50) return false;
    if (filters.closingSoon && tender.deadline_date) {
      const days = (new Date(`${tender.deadline_date}T00:00:00`).getTime() - startOfDay(today).getTime()) / DAY;
      if (days > 30) return false;
    }
    if (filters.hideFrameworks && isFramework(tender.title)) return false;
    return true;
  });
}

// Renewals and early signals have full CPV codes; the company stores prefixes.
export function matchesSectors(cpvCodes: string[] | null, prefixes: string[]) {
  if (!prefixes.length) return true;
  return (cpvCodes || []).some((code) => prefixes.some((prefix) => code.startsWith(prefix)));
}
