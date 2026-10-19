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
    if (!suggestion.value_text.trim() && !suggestion.values.length) continue; // never blank a field
    const automatic =
      suggestion.evidence_state !== "conflict" &&
      field !== "website_url" &&
      (!NEEDS_VERIFIED_QUOTE.has(field) || suggestion.verified) &&
      !(field === "description" && next.description.trim()) &&
      // A size range hides tenders outside it, so it's always the user's call.
      field !== "min_budget" &&
      field !== "max_budget";
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
