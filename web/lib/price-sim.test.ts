import { describe, expect, it } from "vitest";
import {
  abnormalFlags,
  abnormalFromChecklist,
  abnormalLimit,
  advise,
  formulaFromChecklist,
  marketFrom,
  pricePoints,
  setupFrom,
  simulate,
  type PriceSetup,
} from "./price-sim";

const base: PriceSetup = { budget: 100_000, maxPoints: 80, formula: "lowest_ratio", maxDiscount: null, abnormal: { kind: "rglcap85" } };

// Formula texts as they appear in the three verified checklists.
const CHATBOT = "P = 60 x (log (mo))/(log(O)); mo = best (lowest) offer, O = offer being scored, log base 10. Max discount 20%.";
const CYBER = "Pi = (Ofmin (€) / Ofi (€)) · Pmax,ec, with Ofmin = lowest offer, Ofi = offer i, Pmax,ec = 80";
const CEMETERY = "Pᵢ = 70 × (Bᵢ / Bmáx); Bᵢ = [(PBL − Oᵢ) / PBL] × 100";

describe("price points", () => {
  it("lowest offer ÷ your offer", () => {
    expect(pricePoints(base, 0.2, 0.2)).toBe(80);
    expect(pricePoints(base, 0.1, 0.2)).toBe(71.11); // 80 × 80k / 90k
    expect(pricePoints(base, 0, 0.2)).toBe(64); // bidding the budget still scores
  });

  it("your discount ÷ biggest discount scores 0 at the budget", () => {
    const setup = { ...base, maxPoints: 70, formula: "discount_ratio" as const };
    expect(pricePoints(setup, 0.1, 0.2)).toBe(35);
    expect(pricePoints(setup, 0, 0.2)).toBe(0);
  });

  it("logarithmic barely separates offers and respects the discount cap", () => {
    const setup = { ...base, maxPoints: 60, formula: "logarithmic" as const, maxDiscount: 0.2 };
    const full = pricePoints(setup, 0, 0.2);
    expect(60 - full).toBeLessThan(1.5);
    expect(pricePoints(setup, 0.2, 0.2)).toBe(60);
    expect(pricePoints(setup, 0.25, 0.25)).toBe(0);
  });

  it("linear goes from 0 at the budget to max at the lowest offer", () => {
    const setup = { ...base, formula: "linear" as const };
    expect(pricePoints(setup, 0.1, 0.2)).toBe(40);
  });
});

describe("abnormally low (art. 85 RGLCAP)", () => {
  const rule = { kind: "rglcap85" } as const;
  it("1 bidder: more than 25 points below the budget", () => {
    expect(abnormalFlags(rule, [0.25])).toEqual([false]);
    expect(abnormalFlags(rule, [0.26])).toEqual([true]);
    expect(abnormalLimit(rule, [])).toBe(0.25);
  });
  it("2 bidders: more than 20 points below the other", () => {
    expect(abnormalFlags(rule, [0.35, 0.1])).toEqual([true, false]);
    expect(abnormalFlags(rule, [0.3, 0.1])).toEqual([false, false]);
  });
  it("3 bidders: 10 points above the average, and always above 25", () => {
    expect(abnormalFlags(rule, [0.2, 0.05, 0.08])).toEqual([false, false, false]);
    expect(abnormalFlags(rule, [0.27, 0.2, 0.2])[0]).toBe(true);
    expect(abnormalFlags(rule, [0.3, 0.1, 0.1])[0]).toBe(true);
  });
  it("4+ bidders: 10 points above the average", () => {
    expect(abnormalFlags(rule, [0.3, 0.1, 0.1, 0.1])).toEqual([true, false, false, false]);
    expect(abnormalFlags(rule, [0.2, 0.1, 0.1, 0.1])).toEqual([false, false, false, false]);
  });
  it("tender-specific rules", () => {
    expect(abnormalFlags({ kind: "below_budget", points: 20 }, [0.21, 0.19])).toEqual([true, false]);
    expect(abnormalFlags({ kind: "none" }, [0.9])).toEqual([false]);
  });
});

describe("reading the checklist", () => {
  it("recognises the formula types of the verified tenders", () => {
    expect(formulaFromChecklist({ formula: CHATBOT })).toEqual({ formula: "logarithmic", maxDiscount: 0.2, known: true });
    expect(formulaFromChecklist({ formula: CYBER })).toEqual({ formula: "lowest_ratio", maxDiscount: null, known: true });
    expect(formulaFromChecklist({ formula: CEMETERY }).formula).toBe("discount_ratio");
    expect(formulaFromChecklist(null)).toEqual({ formula: "lowest_ratio", maxDiscount: null, known: false });
  });
  it("recognises the abnormal-low rule", () => {
    expect(abnormalFromChecklist({ abnormally_low_rule: "Presumed abnormally low if more than 20% below the base budget" })).toEqual({
      kind: "below_budget",
      points: 20,
    });
    expect(abnormalFromChecklist({ abnormally_low_rule: "Art. 85 RGLCAP thresholds" })).toEqual({ kind: "rglcap85" });
    expect(abnormalFromChecklist(null)).toEqual({ kind: "rglcap85" });
  });
  it("falls back to safe defaults with no budget or price weight", () => {
    const setup = setupFrom({ budget: null, pricePoints: null, price: null });
    expect(setup.budget).toBe(100_000);
    expect(setup.maxPoints).toBe(100);
    expect(setup.formulaKnown).toBe(false);
  });
});

describe("market and advice", () => {
  it("assumes rivals when there is no history", () => {
    const market = marketFrom([], 3);
    expect(market.rivals).toEqual([0.2, 0.1]);
    expect(market.typical).toBeNull();
  });
  it("spreads rivals across past winning discounts", () => {
    const market = marketFrom([0.05, 0.1, 0.15, 0.2, 0.25, 2], 4);
    expect(market.bidders).toBe(4);
    expect(market.rivals).toHaveLength(3);
    expect(market.typical).toBe(0.15);
    expect(market.basis).toContain("5 past winning discounts");
  });
  it("recommends the best score that is not abnormally low", () => {
    const market = marketFrom([0.05, 0.1, 0.12, 0.15, 0.2], 3);
    const advice = advise(base, market);
    expect(advice.safeMax).not.toBeNull();
    expect(advice.sweetSpot?.abnormal).toBe(false);
    expect(advice.sweetSpot!.discount).toBeLessThanOrEqual(advice.safeMax! + 1e-9);
    const rows = simulate(base, market.rivals);
    expect(rows[0].discount).toBe(0);
    expect(rows.at(-1)!.discount).toBe(0.5);
  });
});
