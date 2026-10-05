import { planResearchFill } from "./research-fill";
import type { CompanyProfile, ImportResult, ImportSuggestion } from "./types";

// First-run onboarding: one step per company-page section, prefilled from research.

export type StepId = "what" | "where" | "finances" | "registrations" | "certifications" | "documents";
type Field = keyof CompanyProfile;

export const STEPS: Array<{ id: StepId; label: string; fields: Field[] }> = [
  { id: "what", label: "What you do", fields: ["name", "nif", "description", "cpv_prefixes", "keywords"] },
  { id: "where", label: "Where you bid", fields: ["regions", "include_national", "min_budget", "max_budget"] },
  { id: "finances", label: "Finances", fields: ["annual_turnover", "employees"] },
  {
    id: "registrations",
    label: "Registrations",
    fields: ["rolece_status", "rolece_last_verified_at", "classification_status", "classification_codes"],
  },
  { id: "certifications", label: "Certifications", fields: ["certifications"] },
  { id: "documents", label: "Documents", fields: [] },
];

export type Sources = Partial<Record<Field, ImportSuggestion[]>>;

// Research arrives while the user may already be editing: fill only fields they
// haven't touched, and keep everything else as suggestions to accept by hand.
export function mergeResearch(draft: CompanyProfile, touched: ReadonlySet<Field>, result: ImportResult) {
  const untouched = result.suggestions.filter((suggestion) => !touched.has(suggestion.field));
  const fill = planResearchFill(draft, { ...result, suggestions: untouched });
  const sources: Sources = {};
  for (const suggestion of fill.applied) {
    (sources[suggestion.field] ??= []).push(suggestion);
  }
  const review = [
    ...fill.review,
    ...result.suggestions.filter((suggestion) => touched.has(suggestion.field)),
  ].filter((suggestion) => suggestion.field !== "website_url");
  return { next: { ...draft, ...fill.patch }, patch: fill.patch, sources, review, found: fill.applied.length };
}

export type OnboardingProgress = {
  step: number;
  deferred: StepId[];
  completed: boolean;
};

const progressKey = (companyId: string) => `bidmagnet:onboarding:${companyId}`;

export function readProgress(companyId: string): OnboardingProgress | null {
  try {
    return JSON.parse(localStorage.getItem(progressKey(companyId)) || "null");
  } catch {
    return null;
  }
}

export function writeProgress(companyId: string, progress: OnboardingProgress) {
  try {
    localStorage.setItem(progressKey(companyId), JSON.stringify(progress));
  } catch {
    // Without storage a reload restarts the steps; nothing is lost from the profile.
  }
}

// Fields of one step that changed, for a partial save.
export function stepPatch(step: StepId, saved: CompanyProfile, draft: CompanyProfile) {
  const fields = STEPS.find((item) => item.id === step)?.fields ?? [];
  const patch: Partial<CompanyProfile> = {};
  for (const field of fields) {
    if (field === "name" && !draft.name.trim()) continue; // a company always keeps its name
    if (JSON.stringify(saved[field]) !== JSON.stringify(draft[field])) {
      Object.assign(patch, { [field]: draft[field] });
    }
  }
  return patch;
}

// Euro amounts typed the Spanish way ("1.250.000") or plainly.
export function parseEuros(text: string) {
  const digits = text.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

const ES = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 0, useGrouping: true });
export function formatEuros(value: number | null) {
  return value === null ? "" : ES.format(value);
}
