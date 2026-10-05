import { describe, expect, it } from "vitest";
import {
  isStillOpen,
  todayInSpain,
  applyFilters,
  businessDaysUntil,
  durationLabel,
  euroShort,
  matchesSectors,
  sourceLabel,
  weighting,
  DEFAULT_FILTERS,
  detailedCount,
  sortTenders,
  type FeedTender,
  type Filters,
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

  it("applies general and detailed filters", () => {
    const base: Omit<FeedTender, "tender_id" | "title" | "score" | "deadline_date"> = {
      reasons: [], has_checklist: false, link: null, source: "placsp", duration: null, duration_unit: null,
      kind: "open", buyer_name: null, region: null, budget_no_tax: null, deadline_time: null, procedure_label: null,
    };
    const tenders: FeedTender[] = [
      { ...base, tender_id: "a", title: "Portal web", score: 80, deadline_date: "2026-10-30", region: "Madrid", it_segment: "core", procedure_label: "Abierto simplificado", price_points: 60, duration: 2, duration_unit: "ANN" },
      { ...base, tender_id: "b", title: "Acuerdo marco de software", score: 70, deadline_date: "2026-10-30", region: "Galicia" },
      { ...base, tender_id: "c", title: "Suministro de portátiles", score: 40, deadline_date: "2026-10-06", region: "Madrid", it_segment: "hardware", buyer_name: "Ayuntamiento de Móstoles" },
      { ...base, tender_id: "d", title: "Cloud", score: 90, deadline_date: "2026-12-30", reasons: [{ type: "gap", points: -10, text: "Asks for ISO 27001 (you don't have it)" }] },
    ];
    const today = new Date(2026, 9, 5);
    const run = (patch: Partial<Filters>) =>
      applyFilters(tenders, { ...DEFAULT_FILTERS, ...patch }, ["Madrid"], today).map((t) => t.tender_id);

    expect(run({})).toEqual(["a", "b", "c", "d"]);
    expect(run({ query: "mostoles" })).toEqual(["c"]);
    expect(run({ qualify: true })).toEqual(["a", "b", "c"]);
    expect(run({ deadline: "time" })).toEqual(["a", "b", "d"]);
    expect(run({ deadline: "soon" })).toEqual(["c"]);
    expect(run({ region: "mine" })).toEqual(["a", "c"]);
    expect(run({ minFit: true, hideFrameworks: true })).toEqual(["a", "d"]);
    expect(run({ work: ["core"], procedure: ["simplified"], scoring: "price", duration: "mid" })).toEqual(["a"]);
    expect(detailedCount({ ...DEFAULT_FILTERS, work: ["core"], scoring: "price" })).toBe(2);
  });

  it("sorts by deadline or budget", () => {
    const base = { reasons: [], has_checklist: false, link: null, source: "placsp", duration: null, duration_unit: null, kind: "open" as const, buyer_name: null, region: null, deadline_time: null, procedure_label: null, title: "", score: 1 };
    const list: FeedTender[] = [
      { ...base, tender_id: "x", deadline_date: "2026-11-01", budget_no_tax: 10 },
      { ...base, tender_id: "y", deadline_date: "2026-10-10", budget_no_tax: 500 },
    ];
    expect(sortTenders(list, "deadline").map((t) => t.tender_id)).toEqual(["y", "x"]);
    expect(sortTenders(list, "budget").map((t) => t.tender_id)).toEqual(["y", "x"]);
    expect(sortTenders(list, "fit").map((t) => t.tender_id)).toEqual(["x", "y"]);
  });

  it("matches full CPV codes against profile prefixes", () => {
    expect(matchesSectors(["72260000"], ["7226"])).toBe(true);
    expect(matchesSectors(["30200000"], ["72", "48"])).toBe(false);
    expect(matchesSectors(null, [])).toBe(true);
  });

});

describe("isStillOpen", () => {
  it("drops tenders closing today or earlier", () => {
    expect(isStillOpen("2026-10-05", "2026-10-05")).toBe(false);
    expect(isStillOpen("2026-10-04", "2026-10-05")).toBe(false);
    expect(isStillOpen("2026-10-06", "2026-10-05")).toBe(true);
    expect(isStillOpen(null, "2026-10-05")).toBe(true);
  });

  it("uses the date in Spain", () => {
    // 23:30 UTC on 4 Oct is already 5 Oct in Madrid
    expect(todayInSpain(new Date("2026-10-04T23:30:00Z"))).toBe("2026-10-05");
  });
});
