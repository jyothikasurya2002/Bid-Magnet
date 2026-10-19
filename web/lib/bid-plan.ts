import { dateFormat } from "./dates";
import type { CompanyProfile } from "./types";

// 4a: every task of a bid, grouped by envelope and laid out on the business days
// left before the deadline. Built from the cited checklist when we have one, else
// from the notice's structured requirements and criteria.

export type Cite = { doc: "pcap" | "ppt" | null; page: number | null; quote: string | null };

export type TaskKind = "clarify" | "eligibility" | "document" | "draft" | "commitment" | "price" | "review" | "submit";

export type ProfileCheck = "met" | "missing" | "unknown";

export type Fact = { label: string; value: string; tone?: "ok" | "warn" };

export type PlanTask = {
  id: string;
  title: string;
  detail: string | null;
  kind: TaskKind;
  points: number | null;
  cite: Cite | null;
  start: number; // index into plan.days
  end: number;
  conditional: boolean; // "only if bidding as a UTE", "if applicable"
  check: ProfileCheck | null; // eligibility tasks: what the company profile says
  envelope: string | null; // the pliego's own name for it, e.g. "Sobre UNO"
  facts: Fact[]; // the numbers that matter for this task, shown when it's opened
  options: Array<{ when: string; points: string }>; // formula criteria: what earns what
};

type TaskDraft = Omit<PlanTask, "start" | "end" | "facts" | "options" | "envelope"> &
  Partial<Pick<PlanTask, "facts" | "options" | "envelope">>;

export type PlanGroup = { key: string; label: string; hint: string | null; points: number | null; tasks: PlanTask[] };

export type PlanNote = { text: string; cite: Cite | null };

export type BidPlan = {
  source: "checklist" | "notice";
  days: string[]; // business days, today through the deadline
  groups: PlanGroup[];
  clarifications: PlanNote[];
  risks: PlanNote[];
  notes: PlanNote[];
  keyDates: Array<{ label: string; date: string | null; cite: Cite | null }>;
  price: { formula: string | null; explained: string | null; abnormallyLow: string | null; guarantee: string | null; cite: Cite | null } | null;
  submission: string | null;
  afterAward: string[];
  questionsBy: string | null; // last day to ask the buyer
};

type Cited = { doc?: string | null; page?: number | null; quote?: string | null };

export type Checklist = {
  summary?: { submission?: string | null } | null;
  key_dates?: Array<Cited & { label: string; date: string | null }> | null;
  envelopes?: Array<Cited & { name: string; contents?: string[] | null }> | null;
  mandatory_documents?: Array<Cited & { name: string; description_en?: string | null; envelope?: string | null; when?: string | null }> | null;
  eligibility?: Array<Cited & { category: string; requirement_en: string; threshold?: string | null; alternative?: string | null }> | null;
  award_criteria?: Array<Cited & { name: string; kind: string; points: number | null; how_scored_en?: string | null; envelope?: string | null }> | null;
  price?: (Cited & {
    formula?: string | null;
    formula_explained_en?: string | null;
    abnormally_low_rule?: string | null;
    provisional_guarantee?: string | null;
    definitive_guarantee?: string | null;
  }) | null;
  exclusion_risks?: Array<Cited & { risk_en: string }> | null;
  review_notes?: string[] | null;
};

export type NoticeCriterion = { type: string | null; subtype: string | null; description: string | null; weight: number | string | null };
export type NoticeRequirement = { kind: string | null; code: string | null; description: string | null; threshold: number | string | null };

export type PlanInput = {
  today: string; // YYYY-MM-DD in Spain
  deadline: string | null;
  platform: string;
  checklist: Checklist | null;
  criteria: NoticeCriterion[];
  requirements: NoticeRequirement[];
  company: Pick<CompanyProfile, "rolece_status" | "classification_status" | "certifications" | "annual_turnover"> &
    Partial<Pick<CompanyProfile, "employees" | "classification_codes">>;
  vault: string[]; // document_type of the company's uploaded documents
  budget?: number | null;
  deadlineTime?: string | null;
  buyer?: { medianDiscount: number | null; medianBidders: number | null } | null;
};

// ---------- dates ----------

function parse(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

// Weekdays from today to the deadline, both included. At least one day.
export function planDays(today: string, deadline: string | null, fallback = 10) {
  const days: string[] = [];
  const day = parse(today);
  const end = deadline ? parse(deadline) : null;
  while (end ? day <= end : days.length < fallback) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(iso(day));
    day.setUTCDate(day.getUTCDate() + 1);
    if (days.length > 120) break;
  }
  return days.length ? days : [today.slice(0, 10)];
}

// The index of the last business day on or before `date`, within the plan.
export function dayIndex(days: string[], date: string) {
  let index = -1;
  for (let i = 0; i < days.length; i += 1) if (days[i] <= date) index = i;
  return index;
}

// ---------- helpers ----------

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function citeOf(item: Cited | null | undefined): Cite | null {
  if (!item || (!item.page && !item.quote)) return null;
  const doc = item.doc ? (fold(item.doc).startsWith("ppt") ? "ppt" : fold(item.doc).startsWith("pcap") ? "pcap" : null) : null;
  return { doc, page: item.page ?? null, quote: item.quote ?? null };
}

const slug = (text: string) =>
  fold(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

const CONDITIONAL = /\b(if applicable|only if|only for|if the contract|ute)\b|\(if /i;

// "Sobre UNO", "Sobre 2", "Envelope B", "Archivo único" -> a comparable token.
const NUMBER_WORDS: Record<string, string> = { uno: "1", una: "1", dos: "2", tres: "3", a: "1", b: "2", c: "3", one: "1", two: "2", three: "3" };
export function envelopeToken(name: string | null | undefined) {
  if (!name) return null;
  const text = fold(name);
  if (/\bunic[oa]\b|\bsingle\b/.test(text)) return "single";
  const match = text.match(/\b(?:sobre|envelope|archivo|file)\s*(?:n[ºo.]?\s*)?([0-9]|uno|una|dos|tres|a|b|c|one|two|three)\b/);
  if (match) return NUMBER_WORDS[match[1]] ?? match[1];
  return null;
}

// "Sobre UNO – Documentación administrativa (per lot)" -> "Documentación administrativa"
function envelopeLabel(name: string, position: number, total: number) {
  if (total === 1) return "Single envelope";
  const rest = name
    .replace(/^\s*(sobre|envelope|archivo electr[oó]nico|archivo)\s*(n[ºo.]?\s*)?([0-9]+|uno|una|dos|tres|[abc])\b\s*[–:.-]?\s*/i, "")
    .replace(/\s*\(.*?\)\s*$/, "")
    .trim();
  return `Envelope ${position + 1}${rest ? ` · ${rest}` : ""}`;
}

function span(days: number, from: number, to: number) {
  const last = days - 1;
  const start = Math.max(0, Math.min(last, Math.floor(from * last)));
  const end = Math.max(start, Math.min(last, Math.ceil(to * last)));
  return { start, end };
}

// Where each kind of task sits on the way to the deadline (share of the time left).
const WINDOWS: Record<TaskKind, [number, number]> = {
  clarify: [0, 0.2],
  eligibility: [0, 0.25],
  document: [0.1, 0.55],
  draft: [0.1, 0.75],
  commitment: [0.3, 0.7],
  price: [0.55, 0.85],
  review: [0.85, 0.95],
  submit: [1, 1],
};

function schedule(draft: TaskDraft, days: string[], position = 0, of = 1): PlanTask {
  const task = { envelope: null, facts: [], options: [], ...draft };
  const [from, to] = WINDOWS[task.kind];
  if (task.kind === "review" || task.kind === "submit") {
    const last = days.length - 1;
    const index = task.kind === "submit" ? last : Math.max(0, last - 1);
    return { ...task, start: index, end: index };
  }
  // Stagger tasks of the same kind a little so the plan reads as a sequence.
  const shift = of > 1 ? ((to - from) * 0.3 * position) / (of - 1) : 0;
  return { ...task, ...span(days.length, from + shift, Math.min(to, to - 0.3 * (to - from) + shift)) };
}

function profileCheck(category: string, text: string, input: PlanInput): ProfileCheck {
  const body = fold(text);
  const company = input.company;
  if (category === "registry" || /rolece|registro oficial/.test(body)) {
    if (company.rolece_status === "active" || input.vault.includes("ROLECE")) return "met";
    if (company.rolece_status === "not_registered") return "missing";
    return "unknown";
  }
  if (category === "classification") {
    if (/no (business )?classification|not required|no es exigible/.test(body)) return "met";
    if (company.classification_status === "active") return "met";
    if (company.classification_status === "not_held") return "missing";
    return "unknown";
  }
  if (category === "certification") {
    const held = [...company.certifications, ...input.vault].map(fold).join(" ");
    const wanted = ["ens", "27001", "9001", "14001", "20000", "22301", "62443"].filter((cert) =>
      new RegExp(`\\b${cert}\\b`).test(body),
    );
    if (!wanted.length) return "unknown";
    return wanted.every((cert) => new RegExp(`\\b${cert}\\b`).test(held)) ? "met" : "missing";
  }
  if (category === "financial_solvency" && /exempt|no financial|se eximira/.test(body)) return "met";
  return "unknown";
}

const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

const ROLECE_LABEL: Record<string, string> = {
  active: "registered",
  applied: "applied, not yet registered",
  not_registered: "not registered",
  needs_update: "needs updating",
  unknown: "not set in your profile",
};

// What the company profile says about a requirement, as a fact to show beside it.
function profileFact(category: string, input: PlanInput, check: ProfileCheck): Fact | null {
  const company = input.company;
  const tone = check === "met" ? "ok" : check === "missing" ? "warn" : undefined;
  if (category === "registry") {
    const inVault = input.vault.includes("ROLECE") ? " · certificate in your documents" : "";
    return { label: "Your profile", value: `ROLECE ${ROLECE_LABEL[company.rolece_status] ?? company.rolece_status}${inVault}`, tone };
  }
  if (category === "classification") {
    const codes = company.classification_codes?.length ? ` (${company.classification_codes.join(", ")})` : "";
    const label = { active: "held", not_held: "not held", needs_update: "needs updating", unknown: "not set in your profile" }[company.classification_status];
    return { label: "Your profile", value: `Classification ${label ?? company.classification_status}${codes}`, tone };
  }
  if (category === "certification") {
    const held = [...company.certifications, ...input.vault.filter((type) => ["ENS", "ISO"].includes(type))];
    return { label: "Your profile", value: held.length ? held.join(", ") : "No certifications listed", tone };
  }
  if (category === "financial_solvency") {
    return {
      label: "Your profile",
      value: company.annual_turnover ? `Turnover ${EURO.format(company.annual_turnover)}` : "Turnover not set",
      tone,
    };
  }
  if (["technical_solvency", "experience", "team"].includes(category) && company.employees) {
    return { label: "Your profile", value: `${company.employees} employees`, tone };
  }
  return null;
}

// "≥ 99.90% = 5 pts; ≥ 99.75% = 2.5 pts" -> rows of a small scoring table.
export function scoringOptions(text: string | null | undefined) {
  if (!text) return [];
  const rows = text
    .split(/;\s*|\.\s+(?=[≥≤<>]|\d)/)
    .map((part) => part.trim().match(/^(.{1,90}?)\s*(?:=|→|:)\s*([\d.,]+)\s*(?:pts?|points?|puntos)\.?$/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ when: match[1].trim(), points: match[2] }));
  return rows.length >= 2 ? rows : [];
}

const ANNEX = /\b(Anexo|Annex)\s+([IVXLC]+|\d+)\b/i;

const ELIGIBILITY_TITLE: Record<string, string> = {
  registry: "Registry certificate",
  classification: "Business classification",
  certification: "Certification",
  financial_solvency: "Financial solvency",
  technical_solvency: "Technical solvency",
  experience: "Experience",
  team: "Minimum team",
};

const CLARIFY = /contradict|ambigu|inconsisten|unclear|clarif/i;

// ---------- from the cited checklist ----------

function fromChecklist(checklist: Checklist, input: PlanInput, days: string[]): BidPlan {
  const envelopes = (checklist.envelopes || []).filter((envelope) => envelope.name);
  const groups: PlanGroup[] = envelopes.map((envelope, position) => ({
    key: `env-${position}`,
    label: envelopeLabel(envelope.name, position, envelopes.length),
    hint: envelope.name,
    points: null,
    tasks: [],
  }));
  if (!groups.length) groups.push({ key: "env-0", label: "Your bid", hint: null, points: null, tasks: [] });
  const tokens = envelopes.map((envelope) => envelopeToken(envelope.name));

  // Which envelope something goes in; falls back to the first (documents) or last (price).
  const groupFor = (envelope: string | null | undefined, fallback: "first" | "last") => {
    if (groups.length === 1) return groups[0];
    const token = envelopeToken(envelope);
    const index = token ? tokens.indexOf(token) : -1;
    return index >= 0 ? groups[index] : fallback === "first" ? groups[0] : groups[groups.length - 1];
  };

  const before: PlanGroup = { key: "before", label: "Before you start", hint: "Can you bid at all?", points: null, tasks: [] };
  const finish: PlanGroup = { key: "finish", label: "Sign & submit", hint: null, points: null, tasks: [] };

  // Questions for the buyer, from the contradictions found while reading the pliegos.
  const notes = checklist.review_notes || [];
  const clarifications = notes.filter((note) => CLARIFY.test(note)).map((text) => ({ text, cite: null }));
  const questionDate = (checklist.key_dates || []).find((item) => item.date && /question|clarif|aclara|consult/i.test(item.label))?.date ?? null;
  const questionIndex = questionDate ? dayIndex(days, questionDate) : -1;
  if (clarifications.length) {
    const task = schedule(
      {
        id: "clarify",
        title: `Ask the buyer to clarify ${clarifications.length} point${clarifications.length === 1 ? "" : "s"}`,
        detail: clarifications.map((note) => note.text).join("\n"),
        kind: "clarify",
        points: null,
        cite: null,
        conditional: false,
        check: null,
      },
      days,
    );
    before.tasks.push(questionIndex >= 0 ? { ...task, start: 0, end: questionIndex } : task);
  }

  const eligibility = (checklist.eligibility || []).filter((item) => item.category !== "other");
  eligibility.forEach((item, position) => {
    const check = profileCheck(item.category, `${item.requirement_en} ${item.threshold ?? ""}`, input);
    const mine = profileFact(item.category, input, check);
    before.tasks.push(
      schedule(
        {
          id: `elig-${position}-${slug(item.category)}`,
          title: ELIGIBILITY_TITLE[item.category] ?? item.category.replace(/_/g, " "),
          detail: item.requirement_en,
          kind: "eligibility",
          points: null,
          cite: citeOf(item),
          conditional: false,
          check,
          facts: [
            item.threshold ? { label: "Required", value: item.threshold } : null,
            mine,
            item.alternative ? { label: "Alternative", value: item.alternative } : null,
          ].filter((fact): fact is Fact => Boolean(fact)),
        },
        days,
      ),
    );
  });

  const documents = (checklist.mandatory_documents || []).filter((doc) => doc.when !== "awardee_only");
  documents.forEach((doc, position) => {
    const group = groupFor(doc.envelope, "first");
    const annex = `${doc.name} ${doc.description_en ?? ""}`.match(ANNEX);
    group.tasks.push(
      schedule(
        {
          id: `doc-${position}-${slug(doc.name)}`,
          title: doc.name,
          detail: doc.description_en ?? null,
          kind: "document",
          points: null,
          cite: citeOf(doc),
          conditional: CONDITIONAL.test(`${doc.name} ${doc.description_en ?? ""}`),
          check: null,
          envelope: group.hint,
          facts: [
            { label: "Goes in", value: group.hint ?? group.label },
            annex ? { label: "Template", value: `${annex[1][0].toUpperCase()}${annex[1].slice(1).toLowerCase()} ${annex[2]} of the PCAP` } : null,
            { label: "Handed in", value: doc.when === "unclear" ? "Unclear: check the PCAP" : "With the bid" },
          ].filter((fact): fact is Fact => Boolean(fact)),
        },
        days,
        position,
        documents.length,
      ),
    );
  });

  const criteria = checklist.award_criteria || [];
  const judged = criteria.filter((item) => item.kind !== "price" && item.kind !== "automatic_formula");
  criteria.forEach((item, position) => {
    const kind: TaskKind = item.kind === "price" ? "price" : item.kind === "automatic_formula" ? "commitment" : "draft";
    const group = groupFor(item.envelope, kind === "draft" ? "first" : "last");
    group.points = (group.points ?? 0) + (Number(item.points) || 0);
    group.tasks.push(
      schedule(
        {
          id: `crit-${position}-${slug(item.name)}`,
          title: kind === "price" ? `Set the price · ${item.name}` : kind === "draft" ? `Write: ${item.name}` : `Decide: ${item.name}`,
          detail: item.how_scored_en ?? null,
          kind,
          points: item.points === null ? null : Number(item.points),
          cite: citeOf(item),
          conditional: false,
          check: null,
          envelope: group.hint,
          options: kind === "commitment" ? scoringOptions(item.how_scored_en) : [],
        },
        days,
        kind === "draft" ? judged.indexOf(item) : 0,
        kind === "draft" ? judged.length : 1,
      ),
    );
  });

  finish.tasks.push(
    schedule({ id: "review", title: "Internal review: every envelope, signed", detail: "Check that nothing contradicts across documents, figures match the price offer, and every file is signed.", kind: "review", points: null, cite: null, conditional: false, check: null }, days),
    schedule({ id: "submit", title: `Submit on ${input.platform}`, detail: checklist.summary?.submission ?? null, kind: "submit", points: null, cite: null, conditional: false, check: null }, days),
  );

  const price = checklist.price;
  return {
    source: "checklist",
    days,
    groups: [before, ...groups, finish].filter((group) => group.tasks.length),
    clarifications,
    risks: (checklist.exclusion_risks || []).map((risk) => ({ text: risk.risk_en, cite: citeOf(risk) })),
    notes: notes.filter((note) => !CLARIFY.test(note)).map((text) => ({ text, cite: null })),
    keyDates: (checklist.key_dates || []).map((item) => ({ label: item.label, date: item.date, cite: citeOf(item) })),
    price: price
      ? {
          formula: price.formula ?? null,
          explained: price.formula_explained_en ?? null,
          abnormallyLow: price.abnormally_low_rule ?? null,
          guarantee: [price.provisional_guarantee ? `Provisional: ${price.provisional_guarantee}` : null, price.definitive_guarantee ? `Definitive: ${price.definitive_guarantee}` : null]
            .filter(Boolean)
            .join(" · ") || null,
          cite: citeOf(price),
        }
      : null,
    submission: checklist.summary?.submission ?? null,
    afterAward: (checklist.mandatory_documents || []).filter((doc) => doc.when === "awardee_only").map((doc) => doc.name),
    questionsBy: questionDate,
  };
}

// ---------- from the notice's structured data ----------

const DECLARATIONS = "Declaración responsable / DEUC";

function fromNotice(input: PlanInput, days: string[]): BidPlan {
  const before: PlanGroup = { key: "before", label: "Before you start", hint: "Can you bid at all?", points: null, tasks: [] };
  const admin: PlanGroup = { key: "admin", label: "Administrative documents", hint: "Usually envelope 1", points: null, tasks: [] };
  const judged: PlanGroup = { key: "judged", label: "Scored by judgement", hint: "Usually its own envelope", points: null, tasks: [] };
  const formula: PlanGroup = { key: "formula", label: "Price & formula criteria", hint: "Usually the last envelope", points: null, tasks: [] };
  const finish: PlanGroup = { key: "finish", label: "Sign & submit", hint: null, points: null, tasks: [] };

  const requirements = input.requirements;
  const declarations = requirements.filter((item) => item.kind === "declaration");
  admin.tasks.push(
    schedule(
      {
        id: "doc-declaration",
        title: DECLARATIONS,
        detail: declarations.length
          ? `Declares: ${declarations.map((item) => (item.description || "").trim()).filter(Boolean).join("; ")}.`
          : "The responsible declaration or ESPD (DEUC) every bid includes.",
        kind: "document",
        points: null,
        cite: null,
        conditional: false,
        check: null,
      },
      days,
    ),
  );

  const seen = new Set<string>();
  requirements
    .filter((item) => item.kind && item.kind !== "declaration")
    .forEach((item, position) => {
      const key = `${item.kind}:${fold(item.description || "")}`;
      if (seen.has(key)) return;
      seen.add(key);
      const threshold = Number(item.threshold);
      const check: ProfileCheck =
        item.kind === "financial_solvency" && threshold > 0 && input.company.annual_turnover
          ? input.company.annual_turnover >= threshold
            ? "met"
            : "missing"
          : profileCheck(item.kind!, item.description || "", input);
      const mine = profileFact(item.kind!, input, check);
      before.tasks.push(
        schedule(
          {
            id: `elig-${position}-${slug(item.kind!)}`,
            title: ELIGIBILITY_TITLE[item.kind!] ?? item.kind!.replace(/_/g, " "),
            detail: item.description || null,
            kind: "eligibility",
            points: null,
            cite: null,
            conditional: false,
            check,
            facts: [threshold > 0 ? { label: "Required", value: EURO.format(threshold) } : null, mine].filter(
              (fact): fact is Fact => Boolean(fact),
            ),
          },
          days,
        ),
      );
    });

  const subjective = input.criteria.filter((item) => item.type === "SUBJ");
  subjective.forEach((item, position) => {
    const points = Number(item.weight) || null;
    judged.points = (judged.points ?? 0) + (points ?? 0);
    judged.tasks.push(
      schedule(
        {
          id: `crit-s${position}-${slug(item.description || "memoria")}`,
          title: `Write: ${item.description || "Technical proposal"}`,
          detail: "Scored by the evaluators’ judgement.",
          kind: "draft",
          points,
          cite: null,
          conditional: false,
          check: null,
        },
        days,
        position,
        subjective.length,
      ),
    );
  });

  input.criteria
    .filter((item) => item.type !== "SUBJ")
    .forEach((item, position) => {
      const points = Number(item.weight) || null;
      const isPrice = item.subtype === "1" && /econ|preu|precio|price|oferta|descuento/i.test(item.description || "oferta");
      formula.points = (formula.points ?? 0) + (points ?? 0);
      formula.tasks.push(
        schedule(
          {
            id: `crit-o${position}-${slug(item.description || "criterion")}`,
            title: isPrice ? `Set the price · ${item.description || "Oferta económica"}` : `Decide: ${item.description || "Formula criterion"}`,
            detail: isPrice ? "Scored by formula from your price or discount." : "Scored automatically from what you commit to.",
            kind: isPrice ? "price" : "commitment",
            points,
            cite: null,
            conditional: false,
            check: null,
          },
          days,
        ),
      );
    });

  finish.tasks.push(
    schedule({ id: "review", title: "Internal review: every envelope, signed", detail: "Check that nothing contradicts across documents, figures match the price offer, and every file is signed.", kind: "review", points: null, cite: null, conditional: false, check: null }, days),
    schedule({ id: "submit", title: `Submit on ${input.platform}`, detail: null, kind: "submit", points: null, cite: null, conditional: false, check: null }, days),
  );

  return {
    source: "notice",
    days,
    groups: [before, admin, judged, formula, finish].filter((group) => group.tasks.length),
    clarifications: [],
    risks: [],
    notes: [],
    keyDates: [],
    price: null,
    submission: null,
    afterAward: [],
    questionsBy: null,
  };
}

const ORDER: TaskKind[] = ["clarify", "eligibility", "document", "draft", "commitment", "price", "review", "submit"];

export function buildPlan(input: PlanInput): BidPlan {
  const days = planDays(input.today, input.deadline);
  const plan = input.checklist ? fromChecklist(input.checklist, input, days) : fromNotice(input, days);
  // Read top to bottom in the order the work happens.
  for (const group of plan.groups) {
    group.tasks.sort((a, b) => a.start - b.start || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.end - b.end);
  }
  addFacts(plan, input);
  return plan;
}

const DAY_LABEL = dateFormat({ weekday: true });
const local = (isoDate: string) => new Date(`${isoDate.slice(0, 10)}T00:00:00`);

// Numbers every task of a kind shares: points and their share, price context, dates.
function addFacts(plan: BidPlan, input: PlanInput) {
  const tasks = plan.groups.flatMap((group) => group.tasks);
  const total = tasks.reduce((sum, task) => sum + (task.kind !== "eligibility" ? task.points ?? 0 : 0), 0);
  const deadline = input.deadline
    ? `${DAY_LABEL.format(local(input.deadline))}${input.deadlineTime ? `, ${input.deadlineTime.slice(0, 5)}` : ""}`
    : null;
  for (const task of tasks) {
    const extra: Fact[] = [];
    if (task.points) {
      extra.push({ label: "Points", value: `${task.points}${total ? ` of ${total} (${Math.round((task.points / total) * 100)}%)` : ""}` });
    }
    if (task.kind === "draft") extra.push({ label: "Scored by", value: "The evaluators’ judgement" });
    if (task.kind === "commitment") extra.push({ label: "Scored by", value: "Formula: what you commit to" });
    if (task.kind === "draft" || task.kind === "commitment" || task.kind === "price") {
      if (task.envelope) extra.push({ label: "Goes in", value: task.envelope });
    }
    if (task.kind === "price") {
      if (input.budget) extra.push({ label: "Budget (excl. VAT)", value: EURO.format(input.budget) });
      if (input.buyer?.medianDiscount != null) {
        const discount = Math.round(input.buyer.medianDiscount * 1000) / 10;
        extra.push({
          label: "This buyer’s usual discount",
          value: `${discount}%${input.budget ? ` ≈ ${EURO.format(input.budget * (1 - input.buyer.medianDiscount))}` : ""}`,
        });
      }
      if (input.buyer?.medianBidders != null) extra.push({ label: "Usual number of bidders", value: String(input.buyer.medianBidders) });
      if (plan.price?.guarantee) extra.push({ label: "Guarantees", value: plan.price.guarantee });
    }
    if (task.kind === "clarify") {
      extra.push({ label: "Points to clarify", value: String(plan.clarifications.length) });
      if (plan.questionsBy) {
        extra.push({
          label: "Questions close",
          value: DAY_LABEL.format(local(plan.questionsBy)),
        });
      }
    }
    if (task.kind === "submit") {
      extra.push({ label: "Platform", value: input.platform });
      if (deadline) extra.push({ label: "Deadline", value: deadline });
    }
    task.facts = [...extra, ...task.facts];
  }
}

// ---------- progress (kept per browser) ----------

export type TaskStatus = "todo" | "doing" | "done" | "skip";

// Dates the user sets are stored as YYYY-MM-DD: the plan's day columns restart at today.
// `ownerId` is set when you take a task yourself; `owner` is the name shown on it.
export type TaskState = { status?: TaskStatus; owner?: string; ownerId?: string; start?: string; end?: string; note?: string };

// What progress and dates need from a task (also all the to-do list carries).
export type TaskLike = Pick<PlanTask, "id" | "title" | "kind" | "start" | "end" | "check" | "conditional">;

export type PlanState = Record<string, TaskState>;

// Eligibility the profile already proves starts done; conditional documents start skipped.
export function defaultStatus(task: TaskLike): TaskStatus {
  if (task.check === "met") return "done";
  if (task.conditional) return "skip";
  return "todo";
}

export function statusOf(task: TaskLike, state: PlanState): TaskStatus {
  return state[task.id]?.status ?? defaultStatus(task);
}

export function progress(plan: BidPlan, state: PlanState) {
  const tasks = plan.groups.flatMap((group) => group.tasks);
  const counted = tasks.filter((task) => statusOf(task, state) !== "skip");
  return { done: counted.filter((task) => statusOf(task, state) === "done").length, total: counted.length };
}

// Where a task sits on today's columns. `late`: due before today and not finished.
export function taskSpan(task: TaskLike, state: PlanState, days: string[]) {
  const saved = state[task.id] || {};
  const last = days.length - 1;
  const start = saved.start ? Math.max(0, dayIndex(days, saved.start)) : Math.min(last, task.start);
  const due = saved.end ? dayIndex(days, saved.end) : Math.min(last, task.end);
  const status = statusOf(task, state);
  return {
    start,
    end: Math.max(start, Math.min(last, due)),
    late: due < 0 && status !== "done" && status !== "skip",
  };
}

export type MyTask = { task: TaskLike; status: TaskStatus; due: string; late: boolean };

// Tasks you took, not finished yet, soonest first.
export function myTasks(tasks: TaskLike[], state: PlanState, days: string[], userId: string): MyTask[] {
  return tasks
    .filter((task) => state[task.id]?.ownerId === userId)
    .map((task) => {
      const span = taskSpan(task, state, days);
      const saved = state[task.id]?.end;
      return {
        task,
        status: statusOf(task, state),
        due: span.late && saved ? saved : days[span.end],
        late: span.late,
      };
    })
    .filter((item) => item.status !== "done" && item.status !== "skip")
    .sort((a, b) => a.due.localeCompare(b.due));
}

export const planStorageKey = (companyId: string, tenderId: string) => `bidmagnet:plan:${companyId}:${tenderId}`;
