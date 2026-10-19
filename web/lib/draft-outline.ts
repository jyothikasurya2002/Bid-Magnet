import type { Breakdown, BreakdownItem, Cite } from "./breakdown";
import type { CompanyProfile } from "./types";

// Proposal outline for Bid prep, built without AI: one section per scored criterion (most
// points first), saying what to write or commit to, which of the company's facts help, and
// [ADD: …] gaps the team must fill. The AI draft (proposal-draft.ts) writes prose on top of
// this same outline, so both stay aligned with how the tender is scored.

export type OutlineSection = {
  key: string;
  title: string;
  kind: "judgement" | "formula" | "overview";
  points: number | null;
  howScored: string | null;
  cite: Cite | null;
  write: string[]; // what the section must say
  evidence: string[]; // company facts we already hold that support it
  gaps: string[]; // [ADD: …] placeholders the team must fill
};

export type ProposalOutline = {
  sections: OutlineSection[];
  attach: string[]; // documents to submit with the bid
  points: { judgement: number; formula: number; price: number };
  note: string | null;
};

type Company = Pick<CompanyProfile, "name" | "description" | "certifications" | "keywords" | "employees">;

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// Words in a criterion that point to a certificate the company may hold.
const CERT_TERMS: Record<string, string[]> = {
  ENS: ["ens", "esquema nacional de seguridad"],
  ISO27001: ["27001"],
  ISO9001: ["9001"],
  ISO14001: ["14001", "medioambiental", "environmental"],
  ISO45001: ["45001"],
  ISO20000_1: ["20000"],
  ISO22301: ["22301", "continuidad"],
  ISO27701: ["27701"],
  ISO42001: ["42001"],
  CMMI: ["cmmi"],
  SOC2: ["soc 2", "soc2"],
  EN301549: ["301 549", "301549", "accesibilidad", "accessibility"],
};

export function matchingCertificates(text: string, certifications: string[]): string[] {
  const hay = ` ${fold(text)} `;
  return certifications.filter((cert) => {
    const terms = CERT_TERMS[cert.startsWith("ENS_") ? "ENS" : cert] ?? [];
    return terms.some((term) => new RegExp(`[^a-z0-9]${term}[^a-z0-9]`).test(hay));
  });
}

// Typical things evaluators look for, by the theme of the criterion.
const THEMES: Array<{ match: RegExp; write: string[]; gaps: string[] }> = [
  {
    match: /metodolog|methodolog|plan de trabajo|work plan|planificaci|cronograma|timeline/,
    write: ["Phases, milestones and deliverables, tied to the tender's scope", "How you track progress and report to the buyer"],
    gaps: ["[ADD: timeline with dates per phase]"],
  },
  {
    match: /equipo|team|jefe|project manager|perfil|personal|experiencia|experience/,
    write: ["Who does the work: roles, years of experience, relevant past projects", "Named lead and backup"],
    gaps: ["[ADD: CVs or role summaries of the proposed team]"],
  },
  {
    match: /segur|security|\bens\b|27001|ciber|cyber/,
    write: ["Security measures applied to this service", "Certificates in force and their scope"],
    gaps: ["[ADD: certificate numbers and expiry dates]"],
  },
  {
    match: /calidad|quality|sla|tiempo de respuesta|response time|disponibilidad|availability|resoluci/,
    write: ["Service levels you commit to (response, resolution, availability) and how you measure them"],
    gaps: ["[ADD: the exact figures you commit to]"],
  },
  {
    match: /formaci|training|docencia|teaching/,
    write: ["Training offered: hours, audience, format"],
    gaps: ["[ADD: training hours you commit to]"],
  },
  {
    match: /mejora|improvement|valor añadido|added value|innovaci/,
    write: ["Improvements beyond the minimum specs, each with its benefit to the buyer"],
    gaps: ["[ADD: concrete improvements and their cost to you]"],
  },
  {
    match: /sosten|sustainab|ambiental|environment|social|igualdad|equality/,
    write: ["Environmental or social commitments that apply to this contract"],
    gaps: ["[ADD: measurable commitments]"],
  },
];

function section(item: BreakdownItem, kind: "judgement" | "formula", index: number, company: Company): OutlineSection {
  const text = `${item.text} ${item.detail ?? ""}`;
  const folded = fold(text);
  const themes = THEMES.filter((theme) => theme.match.test(folded));
  const certs = matchingCertificates(text, company.certifications);
  const write =
    kind === "formula"
      ? ["State the exact commitment the formula scores (number, level or yes/no) in the offer form", "Attach the proof the documents ask for"]
      : themes.length
        ? themes.flatMap((theme) => theme.write)
        : ["Explain how you will deliver this for this buyer, specifically: avoid generic text"];
  const gaps = kind === "formula" ? [`[ADD: your commitment for "${item.text}"]`] : themes.flatMap((theme) => theme.gaps);
  return {
    key: `${kind}-${index}`,
    title: item.text,
    kind,
    points: item.points,
    howScored: item.detail,
    cite: item.cite,
    write: [...new Set(write)],
    evidence: certs.map((cert) => `You hold ${cert.replace("_", " ")}`),
    gaps: [...new Set(gaps.length ? gaps : ["[ADD: evidence for this criterion]"])],
  };
}

export function buildOutline(breakdown: Breakdown, company: Company): ProposalOutline {
  const byPoints = (a: OutlineSection, b: OutlineSection) => (b.points ?? 0) - (a.points ?? 0);
  const judgement = breakdown.judgement.map((item, i) => section(item, "judgement", i, company)).sort(byPoints);
  const formula = breakdown.formula.map((item, i) => section(item, "formula", i, company)).sort(byPoints);

  const overview: OutlineSection = {
    key: "overview",
    title: "Company overview",
    kind: "overview",
    points: null,
    howScored: null,
    cite: null,
    write: ["Who you are and why you fit this contract, in a short paragraph"],
    evidence: [
      company.description ? company.description : null,
      company.employees ? `${company.employees} employees` : null,
      company.certifications.length ? `Certificates: ${company.certifications.map((c) => c.replace("_", " ")).join(", ")}` : null,
    ].filter(Boolean) as string[],
    gaps: company.description ? ["[ADD: 1–2 similar contracts you delivered]"] : ["[ADD: company description]", "[ADD: 1–2 similar contracts you delivered]"],
  };

  const { totals } = breakdown;
  let note: string | null = null;
  if (!judgement.length && !formula.length) note = "No scored criteria found besides price: check the admin terms.";
  else if (!judgement.length) note = "Nothing here is scored by judgement: the proposal is your commitments plus the price.";
  else if (totals.judgement > totals.price) note = "Judgement criteria outweigh price: the written proposal decides this tender.";

  return {
    sections: [overview, ...judgement, ...formula],
    attach: breakdown.submitWithBid.map((item) => item.text),
    points: { judgement: totals.judgement, formula: totals.formula, price: totals.price },
    note,
  };
}

/** The outline as plain text (Markdown), for copying into a document. */
export function outlineMarkdown(title: string, outline: ProposalOutline): string {
  const lines = [`# Technical proposal: ${title}`, ""];
  if (outline.note) lines.push(`> ${outline.note}`, "");
  for (const s of outline.sections) {
    lines.push(`## ${s.title}${s.points !== null ? ` (${s.points} pts)` : ""}`);
    if (s.howScored) lines.push(`_How it's scored:_ ${s.howScored}`);
    lines.push(...s.write.map((w) => `- ${w}`), ...s.evidence.map((e) => `- ✓ ${e}`), ...s.gaps.map((g) => `- ${g}`), "");
  }
  if (outline.attach.length) lines.push("## Attach with the bid", ...outline.attach.map((a) => `- ${a}`), "");
  return lines.join("\n");
}
