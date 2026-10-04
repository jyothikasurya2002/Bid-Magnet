import { describe, expect, it } from "vitest";
import {
  applyFilters,
  businessDaysUntil,
  durationLabel,
  euroShort,
  matchesSectors,
  sourceLabel,
  weighting,
  type FeedTender,
} from "./discover";

describe("discover helpers", () => {
  it("counts weekdays only", () => {
    const friday = new Date(2026, 9, 2);
    expect(businessDaysUntil("2026-10-05", friday)).toBe(1); // Monday
    expect(businessDaysUntil("2026-10-14", friday)).toBe(8);
    expect(businessDaysUntil("2026-09-30", friday)).toBe(0);
  });

  it("names the platform from the link", () => {
    expect(sourceLabel("regional", "https://www.contratacion.euskadi.eus/x", "País Vasco")).toBe("KontratazioA");
    expect(sourceLabel("placsp", "https://contrataciondelestado.es/wps/poc?x", null)).toBe("PLACSP");
    expect(sourceLabel("regional", null, "Galicia")).toBe("Galicia");
  });

  it("formats durations and amounts", () => {
    expect(durationLabel(24, "MON")).toBe("2 years");
    expect(durationLabel(6, "MON")).toBe("6 months");
    expect(durationLabel(1, "ANN")).toBe("1 year");
    expect(euroShort(286_000)).toBe("€286k");
    expect(euroShort(1_200_000)).toBe("€1.2M");
  });

  it("splits award weighting into formula and judgement, whole contract first", () => {
    expect(
      weighting([
        { type: "OBJ", weight: 55, lot_id: null },
        { type: "SUBJ", weight: 45, lot_id: null },
        { type: "OBJ", weight: 100, lot_id: "2" },
      ]),
    ).toEqual({ formula: 55, judgement: 45 });
    expect(weighting([])).toBeNull();
  });

  it("filters by fit, closing date and framework agreements", () => {
    const base: Omit<FeedTender, "tender_id" | "title" | "score" | "deadline_date"> = {
      reasons: [], has_checklist: false, link: null, source: "placsp", duration: null, duration_unit: null,
      kind: "open", buyer_name: null, region: null, budget_no_tax: null, deadline_time: null, procedure_label: null,
    };
    const tenders: FeedTender[] = [
      { ...base, tender_id: "a", title: "Portal", score: 80, deadline_date: "2026-10-10" },
      { ...base, tender_id: "b", title: "Acuerdo marco de software", score: 70, deadline_date: "2026-10-10" },
      { ...base, tender_id: "c", title: "ERP", score: 40, deadline_date: "2026-10-10" },
      { ...base, tender_id: "d", title: "Cloud", score: 90, deadline_date: "2026-12-30" },
    ];
    const ids = applyFilters(tenders, { minFit: true, closingSoon: true, hideFrameworks: true }, new Date(2026, 9, 4)).map((t) => t.tender_id);
    expect(ids).toEqual(["a"]);
  });

  it("matches full CPV codes against profile prefixes", () => {
    expect(matchesSectors(["72260000"], ["7226"])).toBe(true);
    expect(matchesSectors(["30200000"], ["72", "48"])).toBe(false);
    expect(matchesSectors(null, [])).toBe(true);
  });
});
