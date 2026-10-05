import { describe, expect, it } from "vitest";
import { assembleDecision, awardDiscounts, likelyRivals, median, tidyName, type AwardRow, type DecisionInput } from "./pipeline";

const award = (id: string, date: string, budget: number, amount: number, procedure = "Abierto", lot: string | null = null): AwardRow => ({
  tender_id: id,
  lot_id: lot,
  award_date: date,
  award_amount_no_tax: amount,
  winner_name: "X",
  tenders: { title: id, procedure_label: procedure, budget_no_tax: budget },
});

describe("awardDiscounts", () => {
  it("keeps competitive whole-contract awards, oldest first", () => {
    const points = awardDiscounts([
      award("b", "2026-05-01", 100, 80),
      award("a", "2026-03-01", 100, 90),
      award("n", "2026-04-01", 100, 50, "Negociado sin publicidad"),
      award("l", "2026-04-02", 100, 70, "Abierto", "1"),
      award("z", "2026-04-03", 0, 70),
      award("b", "2026-05-01", 100, 80),
    ]);
    expect(points.map((point) => [point.tender_id, Math.round(point.discount * 100)])).toEqual([
      ["a", 10],
      ["b", 20],
    ]);
  });

  it("keeps only the latest ones", () => {
    const rows = Array.from({ length: 15 }, (_, i) => award(`t${i}`, `2026-01-${String(i + 1).padStart(2, "0")}`, 100, 90));
    expect(awardDiscounts(rows, 12)[0].tender_id).toBe("t3");
  });
});

describe("likelyRivals", () => {
  it("merges similar wins with wins at the buyer and skips the company itself", () => {
    const similar = [
      { winner_name: "Nexo", winner_nif: "B1" },
      { winner_name: "Nexo", winner_nif: "b1" },
      { winner_name: "Us", winner_nif: "B9" },
      { winner_name: "Other", winner_nif: null },
    ].map((row, i) => ({ ...row, tender_id: String(i), title: "", buyer_name: null, discount: null, received_tenders: 1, award_date: null, similarity: 0.6 }));
    const rivals = likelyRivals(similar, [{ name: "Datanorte", nif: "B2", wins: 4 }, { name: "Nexo", nif: "B1", wins: 1 }], "b9");
    expect(rivals.map((rival) => [rival.name, rival.similarWins, rival.buyerWins])).toEqual([
      ["Datanorte", 0, 4],
      ["Nexo", 2, 1],
      ["Other", 1, 0],
    ]);
  });
});

describe("helpers", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("tidyName calms shouting names", () => {
    expect(tidyName("ALPHA SYLTEC INGENIERIA SLP")).toBe("Alpha Syltec Ingenieria SLP");
    expect(tidyName("Inetum España, S.A.")).toBe("Inetum España, S.A.");
  });
});

describe("assembleDecision", () => {
  const input = (patch: Partial<DecisionInput>): DecisionInput => ({
    companyId: "c",
    companyNif: null,
    companyBudget: [100_000, 1_000_000],
    today: "2026-10-05",
    tender: {
      id: "t", title: "x", buyer_name: null, region: null, budget_no_tax: 45_976, deadline_date: "2026-10-07",
      deadline_time: null, procedure_label: null, link: null, source: null, duration: null, duration_unit: null,
    },
    decision: "go", match: null, buyer: null, awards: [], similar: [], criteria: [], price: null, documents: [], trackRecord: null,
    ...patch,
  });

  it("says why there's no fit score", () => {
    expect(assembleDecision(input({})).noScore).toEqual({ kind: "size", min: 100_000, max: 1_000_000 });
    expect(assembleDecision(input({ companyBudget: [null, null] })).noScore).toEqual({ kind: "no_match" });
    expect(assembleDecision(input({ today: "2026-10-09" })).noScore).toEqual({ kind: "closed" });
    expect(assembleDecision(input({ match: { score: 50, reasons: [] } })).noScore).toBeNull();
  });
});
