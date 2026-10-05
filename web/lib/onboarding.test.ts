import { describe, expect, it } from "vitest";
import { formatEuros, mergeResearch, parseEuros, stepPatch } from "./onboarding";
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

describe("onboarding", () => {
  it("fills untouched fields and keeps touched ones for review", () => {
    const draft = { ...EMPTY_COMPANY, name: "Lodo", description: "Escrito a mano." };
    const merged = mergeResearch(
      draft,
      new Set(["description"] as const),
      result([
        suggestion({ field: "description", value_text: "Desarrollamos portales." }),
        suggestion({ field: "keywords", values: ["portal web"] }),
        suggestion({ field: "website_url", value_text: "https://lodo.es/" }),
      ]),
    );
    expect(merged.next.description).toBe("Escrito a mano.");
    expect(merged.next.keywords).toEqual(["portal web"]);
    expect(merged.patch).toEqual({ keywords: ["portal web"] });
    expect(merged.sources.keywords).toHaveLength(1);
    expect(merged.review.map((item) => item.field)).toEqual(["description"]);
    expect(merged.found).toBe(1);
  });

  it("saves only the changed fields of the current step", () => {
    const saved = { ...EMPTY_COMPANY, name: "Lodo" };
    const draft = { ...saved, regions: ["Madrid"], annual_turnover: 900_000 };
    expect(stepPatch("where", saved, draft)).toEqual({ regions: ["Madrid"] });
    expect(stepPatch("finances", saved, draft)).toEqual({ annual_turnover: 900_000 });
  });

  it("reads and writes euro amounts the Spanish way", () => {
    expect(parseEuros("1.250.000")).toBe(1_250_000);
    expect(parseEuros("€ 3,100,000")).toBe(3_100_000);
    expect(parseEuros("")).toBeNull();
    expect(formatEuros(1_250_000)).toBe("1.250.000");
  });
});
