import { describe, expect, it } from "vitest";
import { planResearchFill } from "./research-fill";
import { EMPTY_COMPANY, type ImportResult, type ImportSuggestion } from "./types";

const suggestion = (change: Partial<ImportSuggestion>): ImportSuggestion => ({
  field: "keywords",
  value_text: "",
  values: [],
  evidence_state: "inferred",
  source_url: "https://lodo.es",
  source_title: "Lodo",
  source_quote: "quote",
  explanation: "",
  verified: true,
  ...change,
});

const result = (suggestions: ImportSuggestion[]): ImportResult => ({
  canonical_url: "https://lodo.es",
  legal_name: null,
  ambiguous: false,
  sources: [],
  not_found: [],
  suggestions,
});

describe("first-run research fill", () => {
  const company = { ...EMPTY_COMPANY, name: "Lodo", keywords: ["cloud"] };

  it("fills new facts and leaves conflicts and unverified identity for review", () => {
    const fill = planResearchFill(
      company,
      result([
        suggestion({ field: "description", value_text: "Desarrollamos portales." }),
        suggestion({ field: "keywords", values: ["cloud", "portal web"] }),
        suggestion({ field: "regions", values: ["Madrid"], evidence_state: "conflict" }),
        suggestion({ field: "nif", value_text: "B12345674", verified: false }),
        suggestion({ field: "name", value_text: "Lodo Software, S.L.", evidence_state: "direct_source" }),
      ]),
    );
    expect(fill.patch).toEqual({
      description: "Desarrollamos portales.",
      keywords: ["cloud", "portal web"],
      name: "Lodo Software, S.L.",
    });
    expect(fill.review.map((item) => item.field)).toEqual(["regions", "nif"]);
  });

  it("keeps the first description and skips suggestions that add nothing", () => {
    const fill = planResearchFill(
      company,
      result([
        suggestion({ field: "description", value_text: "Primera." }),
        suggestion({ field: "description", value_text: "Segunda." }),
        suggestion({ field: "keywords", values: ["cloud"] }),
      ]),
    );
    expect(fill.patch).toEqual({ description: "Primera." });
    expect(fill.applied).toHaveLength(1);
    expect(fill.review.map((item) => item.value_text)).toEqual(["Segunda."]);
  });
});
