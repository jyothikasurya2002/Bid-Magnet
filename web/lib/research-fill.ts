import { applyImportSuggestion } from "./profile";
import type { CompanyProfile, ImportResult, ImportSuggestion } from "./types";

// After first-run research, which suggestions to fill in automatically.
// Identity facts (legal name, NIF) and certifications need a quote we found on
// the page; conflicts and anything that adds nothing new are left for the user.
const NEEDS_VERIFIED_QUOTE = new Set<ImportSuggestion["field"]>(["name", "nif", "certifications"]);

export type ResearchFill = {
  patch: Partial<CompanyProfile>;
  applied: ImportSuggestion[];
  review: ImportSuggestion[];
};

export function planResearchFill(company: CompanyProfile, result: ImportResult): ResearchFill {
  let next = company;
  const applied: ImportSuggestion[] = [];
  const review: ImportSuggestion[] = [];

  for (const suggestion of result.suggestions) {
    const field = suggestion.field;
    const automatic =
      suggestion.evidence_state !== "conflict" &&
      field !== "website_url" &&
      (!NEEDS_VERIFIED_QUOTE.has(field) || suggestion.verified) &&
      !(field === "description" && next.description.trim());
    if (!automatic) {
      review.push(suggestion);
      continue;
    }
    const before = next;
    next = applyImportSuggestion(next, suggestion);
    if (JSON.stringify(before[field]) !== JSON.stringify(next[field])) applied.push(suggestion);
  }

  const patch: Partial<CompanyProfile> = {};
  for (const suggestion of applied) {
    Object.assign(patch, { [suggestion.field]: next[suggestion.field] });
  }
  return { patch, applied, review };
}

// Hand-off from the welcome page to the company page's "what we filled in" summary.
export type ResearchSummary = {
  applied: ImportSuggestion[];
  review: ImportSuggestion[];
  sources: number;
  notFound: string[];
};

export const researchSummaryKey = (companyId: string) => `bidmagnet:research-summary:${companyId}`;
