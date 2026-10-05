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
  // open tenders only, for filtering
  it_segment?: string | null;
  contract_type?: string | null;
  has_lots?: boolean | null;
  price_points?: number | null;
  judgement_points?: number | null;
  // renewals only
  incumbent?: string | null;
  estimated_end?: string | null;
};

const DAY = 24 * 60 * 60 * 1000;

// Today's date in Spain (YYYY-MM-DD), where the deadlines are set.
export function todayInSpain(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(now);
}

// A tender closing today or earlier can't realistically be bid on any more.
export function isStillOpen(deadline: string | null, today = todayInSpain()) {
  return deadline === null || deadline.slice(0, 10) > today;
}

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

// "Closes" column: date (with the year when it isn't this year) and time left.
export function closesLabel(deadline: string, today = new Date()) {
  const date = new Date(`${deadline}T00:00:00`);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = `${date.getDate()} ${months[date.getMonth()]}${date.getFullYear() !== today.getFullYear() ? ` ${date.getFullYear()}` : ""}`;
  const days = businessDaysUntil(deadline, today);
  const left =
    days <= 40
      ? `${days} business day${days === 1 ? "" : "s"}`
      : `in ${Math.round((date.getTime() - startOfDay(today).getTime()) / (30.44 * DAY))} months`;
  return { date: label, left, days };
}

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
  if (value === null || value === undefined || value <= 0) return "—";
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

// ---- Discover filters ----
// General ones sit in the toolbar; the rest live in the "More filters" panel.

export type Sort = "fit" | "deadline" | "budget";

export type Filters = {
  query: string;
  qualify: boolean; // hide tenders with a dealbreaker for you
  deadline: "any" | "time" | "soon"; // time: ≥10 business days to prepare; soon: ≤5
  region: "all" | "mine" | string;
  minFit: number; // 0 = any fit
  work: string[]; // it_segment values
  contractType: string[]; // Servicios | Suministros
  procedure: string[]; // open | simplified | restricted | other
  scoring: "any" | "price" | "quality";
  budgetMin: number | null;
  budgetMax: number | null;
  duration: "any" | "short" | "mid" | "long"; // ≤1 year, 1–3 years, 3+ years
  lowCompetition: boolean;
  smallSimplified: boolean;
  singleContract: boolean;
  hideFrameworks: boolean;
  platforms: string[];
};

export const DEFAULT_FILTERS: Filters = {
  query: "",
  qualify: false,
  deadline: "any",
  region: "all",
  minFit: 0,
  work: [],
  contractType: [],
  procedure: [],
  scoring: "any",
  budgetMin: null,
  budgetMax: null,
  duration: "any",
  lowCompetition: false,
  smallSimplified: false,
  singleContract: false,
  hideFrameworks: false,
  platforms: [],
};

export const WORK_OPTIONS = [
  { value: "core", label: "Software & IT services" },
  { value: "hardware", label: "Hardware & equipment" },
  { value: "telecom_network", label: "Telecom & networks" },
];

export const CONTRACT_OPTIONS = [
  { value: "Servicios", label: "Services" },
  { value: "Suministros", label: "Supplies" },
];

export const PROCEDURE_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "simplified", label: "Simplified" },
  { value: "restricted", label: "Restricted" },
  { value: "other", label: "Other" },
];

export function procedureKind(label: string | null) {
  if (!label) return "other";
  if (label === "Abierto") return "open";
  if (label.startsWith("Abierto simplificado")) return "simplified";
  if (label === "Restringido") return "restricted";
  return "other";
}

export function durationMonths(duration: number | null, unit: string | null) {
  if (!duration || !unit) return null;
  if (unit === "ANN") return duration * 12;
  if (unit === "MON") return duration;
  if (unit === "DAY") return duration / 30;
  return null;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const hasReason = (tender: FeedTender, prefix: string) => tender.reasons.some((reason) => reason.text.startsWith(prefix));

// Detailed filters that are on, for the "More filters" count.
export function detailedCount(filters: Filters) {
  return [
    filters.work.length,
    filters.contractType.length,
    filters.procedure.length,
    filters.scoring !== "any",
    filters.budgetMin !== null || filters.budgetMax !== null,
    filters.duration !== "any",
    filters.lowCompetition,
    filters.smallSimplified,
    filters.singleContract,
    filters.hideFrameworks,
    filters.platforms.length,
  ].filter(Boolean).length;
}

export function applyFilters(tenders: FeedTender[], filters: Filters, myRegions: string[] = [], today = new Date()) {
  const words = fold(filters.query).split(/\s+/).filter(Boolean);
  return tenders.filter((tender) => {
    if (words.length) {
      const haystack = fold(`${tender.title} ${tender.buyer_name ?? ""}`);
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    if (filters.qualify && tender.reasons.some((reason) => reason.type === "gap")) return false;
    if (filters.deadline !== "any" && tender.deadline_date) {
      const days = businessDaysUntil(tender.deadline_date, today);
      if (filters.deadline === "time" && days < 10) return false;
      if (filters.deadline === "soon" && days > 5) return false;
    }
    if (filters.region === "mine" && myRegions.length) {
      if (!tender.region || !(myRegions.includes(tender.region) || tender.region === "Nacional")) return false;
    } else if (filters.region !== "all" && filters.region !== "mine" && tender.region !== filters.region) {
      return false;
    }
    if (filters.minFit && tender.score !== null && tender.score < filters.minFit) return false;
    if (filters.work.length && !filters.work.includes(tender.it_segment ?? "")) return false;
    if (filters.contractType.length && !filters.contractType.includes(tender.contract_type ?? "")) return false;
    if (filters.procedure.length && !filters.procedure.includes(procedureKind(tender.procedure_label))) return false;
    if (filters.scoring === "price" && !((tender.price_points ?? 0) >= 60)) return false;
    if (filters.scoring === "quality" && !((tender.judgement_points ?? 0) >= 40)) return false;
    if (filters.budgetMin !== null && (tender.budget_no_tax ?? 0) < filters.budgetMin) return false;
    if (filters.budgetMax !== null && (tender.budget_no_tax === null || tender.budget_no_tax > filters.budgetMax)) return false;
    if (filters.duration !== "any") {
      const months = durationMonths(tender.duration, tender.duration_unit);
      if (months === null) return false;
      if (filters.duration === "short" && months > 12) return false;
      if (filters.duration === "mid" && (months <= 12 || months > 36)) return false;
      if (filters.duration === "long" && months <= 36) return false;
    }
    if (filters.lowCompetition && !hasReason(tender, "Low competition")) return false;
    if (filters.smallSimplified && !hasReason(tender, "Small simplified tender")) return false;
    if (filters.singleContract && tender.has_lots) return false;
    if (filters.hideFrameworks && isFramework(tender.title)) return false;
    if (filters.platforms.length && !filters.platforms.includes(sourceLabel(tender.source, tender.link, tender.region))) return false;
    return true;
  });
}

// Short labels for the filters that are on (shown collapsed in Triage).
export function filterSummary(filters: Filters, sort: Sort) {
  const labels: string[] = [];
  if (filters.query.trim()) labels.push(`“${filters.query.trim()}”`);
  if (filters.qualify) labels.push("I qualify");
  if (filters.deadline === "time") labels.push("Time to prepare");
  if (filters.deadline === "soon") labels.push("Closing soon");
  if (filters.region === "mine") labels.push("My regions");
  else if (filters.region !== "all") labels.push(filters.region);
  if (filters.minFit) labels.push(`Fit ≥ ${filters.minFit}`);
  const more = detailedCount(filters);
  if (more) labels.push(`+${more} more`);
  if (sort !== "fit") labels.push(sort === "deadline" ? "Closing soonest first" : "Largest first");
  return labels;
}

export function sortTenders(tenders: FeedTender[], sort: Sort) {
  if (sort === "fit") return tenders;
  return [...tenders].sort((a, b) =>
    sort === "deadline"
      ? (a.deadline_date ?? "9999").localeCompare(b.deadline_date ?? "9999")
      : (b.budget_no_tax ?? -1) - (a.budget_no_tax ?? -1),
  );
}

// Renewals and early signals have full CPV codes; the company stores prefixes.
export function matchesSectors(cpvCodes: string[] | null, prefixes: string[]) {
  if (!prefixes.length) return true;
  return (cpvCodes || []).some((code) => prefixes.some((prefix) => code.startsWith(prefix)));
}

// The score's reasons count calendar days; the app shows business days everywhere else.
export function reasonLabel(text: string, deadline: string | null, today = new Date()) {
  if (!deadline) return text;
  const days = businessDaysUntil(deadline, today);
  const unit = `business day${days === 1 ? "" : "s"}`;
  return text
    .replace(/^\d+ days to prepare$/, `${days} ${unit} to prepare`)
    .replace(/^Only \d+ days left$/, `Only ${days} ${unit} left`)
    .replace(/^Closes in \d+ days/, `Closes in ${days} ${unit}`);
}

export const TRIAGE_BATCH = 12;

// One-tap reasons for "Not for us", saved in tender_decisions.reason.
export const PASS_REASONS = [
  { key: "too_big", label: "Too big for us" },
  { key: "wrong_work", label: "Not our kind of work" },
  { key: "no_time", label: "Not enough time" },
  { key: "missing_requirement", label: "Missing a requirement" },
  { key: "other", label: "Other" },
] as const;
