import { describe, expect, it } from "vitest";
import { buyerKey, cpvPrefix, experienceCheck, isUsefulSector, historySuggestions, nifVariants, summarizeAwards, withTrackRecord, type CompanyAward } from "./award-history";
import { EMPTY_COMPANY } from "./types";

const award = (id: string, patch: Partial<CompanyAward["tenders"]> & { amount?: number; lot?: string | null; date?: string }): CompanyAward => ({
  tender_id: id,
  lot_id: patch.lot ?? null,
  award_date: patch.date ?? "2026-05-01",
  award_amount_no_tax: patch.amount ?? 100_000,
  winner_name: "Us",
  tenders: {
    title: `Tender ${id}`,
    procedure_label: "Abierto",
    budget_no_tax: 120_000,
    cpv_codes: ["72267000"],
    region: "Madrid",
    buyer_nif: "P2800000A",
    buyer_name: "Ayuntamiento",
    duration: 2,
    duration_unit: "ANN",
    ...patch,
  },
});

describe("award history", () => {
  it("normalises NIFs and sector codes", () => {
    expect(nifVariants("a-41414145")).toEqual(["A41414145", "A-41414145"]);
    expect(cpvPrefix("72267000")).toBe("7226");
    expect(isUsefulSector("7226")).toBe(true);
    expect(isUsefulSector("7200")).toBe(false); // all IT services: too broad
    expect(isUsefulSector("7941")).toBe(false); // not IT
    expect(buyerKey(null, "Ayuntamiento de Móstoles")).toBe("name:ayuntamiento de mostoles");
  });

  it("summarises sectors, regions, sizes, buyers and discounts per tender", () => {
    const history = summarizeAwards([
      award("a", { amount: 50_000, lot: "1" }),
      award("a", { amount: 60_000, lot: "2" }),
      award("b", { amount: 200_000, region: "Andalucía", buyer_nif: null, buyer_name: "Junta" }),
      award("c", { amount: 90_000, cpv_codes: ["48000000"] }),
    ]);
    expect(history.tenders).toBe(3);
    expect(history.sectors[0]).toEqual({ prefix: "7226", count: 2 });
    expect(history.regions).toEqual([
      { region: "Madrid", count: 2 },
      { region: "Andalucía", count: 1 },
    ]);
    expect(history.buyers[0]).toMatchObject({ key: "nif:P2800000A", count: 2 });
    expect(history.size).toEqual({ low: 56_000, typical: 75_000, high: 140_000 });
    expect(history.discount?.sample).toBe(1); // whole-contract awards with a sensible discount only
  });

  it("suggests only what's backed by two or more tenders and not already in the profile", () => {
    const history = summarizeAwards([award("a", {}), award("b", {}), award("c", { region: "Galicia" })]);
    const suggestions = historySuggestions(history, { ...EMPTY_COMPANY, cpv_prefixes: ["72"], regions: [] });
    expect(suggestions.map((item) => item.field)).toEqual(["regions", "min_budget", "max_budget"]);
    expect(suggestions[0].values).toEqual(["Madrid"]);
    expect(historySuggestions(history, { ...EMPTY_COMPANY, min_budget: 1 }).some((item) => item.field === "min_budget")).toBe(false);
  });

  it("checks experience against 70% of the yearly value", () => {
    const awards = [award("a", { amount: 200_000 }), award("b", { amount: 40_000, cpv_codes: ["30200000"] })];
    const check = experienceCheck(awards, { cpv_codes: ["72260000"], budget: 300_000, duration: 3, durationUnit: "ANN" });
    expect(check).toMatchObject({ similar: 1, yearly: 100_000, needed: 70_000, meets: true });
  });
});

describe("withTrackRecord", () => {
  it("adds points for buyers you've won from, by NIF or name", () => {
    const history = summarizeAwards([award("a", {}), award("b", { buyer_nif: null, buyer_name: "Junta de Galicia" })]);
    const row: { score: number | null; reasons: Array<{ type: "ok" | "warn" | "gap"; points: number; text: string }> } = { score: 97, reasons: [] };
    expect(withTrackRecord(row, { nif: "P2800000A", name: null }, history)).toMatchObject({ score: 100 });
    expect(withTrackRecord(row, { nif: "Q1500000B", name: "Junta de Galicia" }, history).reasons[0].text).toBe(
      "You've won 1 contract from this buyer",
    );
    expect(withTrackRecord(row, { nif: "Q9", name: "Other" }, history)).toBe(row);
    expect(withTrackRecord({ score: null, reasons: [] }, { nif: "P2800000A", name: null }, history).score).toBeNull();
  });
});
