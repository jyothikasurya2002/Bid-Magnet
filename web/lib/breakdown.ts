// "Can you bid, and how will you be scored?" — the tender split the way bidders need it:
// 1. what you must meet to take part, 2. criteria scored by formula (price and objective),
// 3. criteria scored by judgement (the technical proposal), plus what to submit and what
// gets bids thrown out. Built from the cited checklist (tender_extractions) when there is
// one, otherwise from the official notice data (tender_criteria + tender_requirements).

export type Cite = { label: string; page: number | null; href: string | null; verified: boolean | null; quote: string | null };

export type BreakdownItem = { text: string; detail: string | null; points: number | null; cite: Cite | null };

export type Breakdown = {
  source: "checklist" | "notice";
  mustMeet: BreakdownItem[];
  price: BreakdownItem[];
  formula: BreakdownItem[];
  judgement: BreakdownItem[];
  totals: { price: number; formula: number; judgement: number };
  submitWithBid: BreakdownItem[];
  submitIfWin: BreakdownItem[];
  exclusions: BreakdownItem[];
  watchOut: string[];
  lotNote: string | null;
};

type DocLink = { kind: string; name: string | null; url: string };
type Cited = { doc?: string | null; page?: number | null; quote?: string | null; verified?: boolean | null };
type Checklist = {
  eligibility?: Array<Cited & { category?: string; requirement_en?: string; threshold?: string | null; alternative?: string | null }>;
  award_criteria?: Array<Cited & { name?: string; kind?: string; points?: number | null; how_scored_en?: string }>;
  mandatory_documents?: Array<Cited & { name?: string; description_en?: string; when?: string }>;
  exclusion_risks?: Array<Cited & { risk_en?: string }>;
  review_notes?: string[];
};
export type NoticeCriterion = { type: string | null; subtype: string | null; weight: number | string | null; lot_id: string | null; description?: string | null };
export type NoticeRequirement = { kind: string | null; code?: string | null; description: string | null; threshold: number | string | null; lot_id: string | null };

const DOC_NAMES: Record<string, string> = { pcap: "Admin terms", ppt: "Tech specs", general: "Document", notice: "Notice", additional: "Annex" };
const CATEGORY: Record<string, string> = {
  financial_solvency: "Financial solvency",
  technical_solvency: "Technical solvency",
  experience: "Experience",
  classification: "Classification",
  certification: "Certification",
  registry: "Registration",
  team: "Team",
  insurance: "Insurance",
  other: "Other",
};

// "pcap__Pliego Administrativo" -> admin terms PDF, linked to the cited page.
export function citeFor(item: Cited, documents: DocLink[]): Cite | null {
  if (!item.doc) return null;
  if (item.doc === "placsp_xml") {
    return { label: "Notice data", page: null, href: null, verified: item.verified ?? null, quote: item.quote ?? null };
  }
  const kind = item.doc.split("__")[0];
  const doc = documents.find((d) => d.kind === kind);
  const page = item.page && item.page > 0 ? item.page : null;
  return {
    label: `${DOC_NAMES[kind] ?? "Document"}${page ? ` p.${page}` : ""}`,
    page,
    href: doc ? `${doc.url}${page ? `#page=${page}` : ""}` : null,
    verified: item.verified ?? null,
    quote: item.quote ?? null,
  };
}

const num = (value: number | string | null | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) && value !== null && value !== "" ? n : null;
};
const sum = (items: BreakdownItem[]) => Math.round(items.reduce((total, item) => total + (item.points ?? 0), 0) * 100) / 100;

function fromChecklist(checklist: Checklist, documents: DocLink[]): Breakdown {
  const cite = (item: Cited) => citeFor(item, documents);
  const criteria = checklist.award_criteria ?? [];
  const asItem = (c: (typeof criteria)[number]): BreakdownItem => ({
    text: c.name ?? "Criterion",
    detail: c.how_scored_en ?? null,
    points: num(c.points),
    cite: cite(c),
  });
  const price = criteria.filter((c) => c.kind === "price").map(asItem);
  const formula = criteria.filter((c) => c.kind === "automatic_formula").map(asItem);
  const judgement = criteria.filter((c) => c.kind === "judgement").map(asItem);
  const docs = checklist.mandatory_documents ?? [];
  const doc = (d: (typeof docs)[number]): BreakdownItem => ({ text: d.name ?? "Document", detail: d.description_en ?? null, points: null, cite: cite(d) });
  return {
    source: "checklist",
    mustMeet: (checklist.eligibility ?? []).map((e) => ({
      text: `${CATEGORY[e.category ?? "other"] ?? "Requirement"}: ${e.requirement_en ?? ""}`.trim(),
      detail: [e.threshold, e.alternative ? `Alternative: ${e.alternative}` : null].filter(Boolean).join(" · ") || null,
      points: null,
      cite: cite(e),
    })),
    price,
    formula,
    judgement,
    totals: { price: sum(price), formula: sum(formula), judgement: sum(judgement) },
    submitWithBid: docs.filter((d) => d.when !== "awardee_only").map(doc),
    submitIfWin: docs.filter((d) => d.when === "awardee_only").map(doc),
    exclusions: (checklist.exclusion_risks ?? []).map((r) => ({ text: r.risk_en ?? "", detail: null, points: null, cite: cite(r) })),
    watchOut: checklist.review_notes ?? [],
    lotNote: null,
  };
}

// Requirements from the notice are often long Spanish paragraphs: keep the first sentence.
function firstSentence(text: string | null, max = 220) {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  const cut = clean.split(/(?<=[.;:])\s/)[0] ?? clean;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

const REQUIREMENT_LABEL: Record<string, string> = {
  financial_solvency: "Financial solvency",
  technical_solvency: "Technical solvency",
  classification: "Classification",
  declaration: "Declaration",
};

function fromNotice(criteria: NoticeCriterion[], requirements: NoticeRequirement[]): Breakdown {
  // Whole-contract criteria when the notice has them, otherwise the first lot's.
  const lots = [...new Set(criteria.map((c) => c.lot_id))];
  const lot = lots.includes(null) ? null : (lots.sort()[0] ?? null);
  const scoped = criteria.filter((c) => c.lot_id === lot);
  const asItem = (c: NoticeCriterion): BreakdownItem => ({ text: c.description || "Criterion", detail: null, points: num(c.weight), cite: null });
  const price = scoped.filter((c) => c.type === "OBJ" && c.subtype === "1").map(asItem);
  const formula = scoped.filter((c) => c.type === "OBJ" && c.subtype !== "1").map(asItem);
  const judgement = scoped.filter((c) => c.type === "SUBJ").map(asItem);
  const reqLot = requirements.some((r) => r.lot_id === null) ? null : lot;
  const seen = new Set<string>();
  const mustMeet = requirements
    .filter((r) => r.lot_id === reqLot && r.kind !== "declaration")
    .map((r) => {
      const threshold = num(r.threshold);
      return {
        text: `${REQUIREMENT_LABEL[r.kind ?? ""] ?? "Requirement"}: ${firstSentence(r.description) || r.code || "see the documents"}`,
        detail: threshold ? `Threshold: ${threshold.toLocaleString("en-IE")}` : null,
        points: null,
        cite: null,
      };
    })
    .filter((item) => (seen.has(item.text) ? false : (seen.add(item.text), true)));
  return {
    source: "notice",
    mustMeet,
    price,
    formula,
    judgement,
    totals: { price: sum(price), formula: sum(formula), judgement: sum(judgement) },
    submitWithBid: [],
    submitIfWin: [],
    exclusions: [],
    watchOut: [],
    lotNote: lot ? `Showing lot ${lot}; other lots may differ.` : null,
  };
}

export function buildBreakdown(input: {
  checklist: Record<string, unknown> | null;
  criteria: NoticeCriterion[];
  requirements: NoticeRequirement[];
  documents: DocLink[];
}): Breakdown {
  return input.checklist
    ? fromChecklist(input.checklist as Checklist, input.documents)
    : fromNotice(input.criteria, input.requirements);
}
