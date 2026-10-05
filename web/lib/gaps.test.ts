import { describe, expect, it } from "vitest";
import { computeGaps } from "./gaps";
import { EMPTY_COMPANY, type MatchReason } from "./types";

const reason = (type: MatchReason["type"], text: string): MatchReason => ({ type, points: 0, text });

describe("gap rail counts", () => {
  const company = { ...EMPTY_COMPANY, annual_turnover: 2_000_000, regions: ["Madrid"] };

  it("counts each tender once per gap, ranks by count, regions last", () => {
    const { gaps, affected, total } = computeGaps(
      [
        {
          tender_id: "a",
          reasons: [
            reason("gap", "Asks for ISO 27001 (you don't have it)"),
            reason("warn", "Register in ROLECE: many tenders require it by the deadline"),
            reason("warn", "Outside your regions (Cataluña)"),
          ],
        },
        {
          tender_id: "b",
          reasons: [reason("warn", "Register in ROLECE: many tenders require it by the deadline")],
        },
        { tender_id: "c", reasons: [reason("ok", "Asks for ISO 27001 (you have it)")] },
      ],
      company,
    );
    expect(total).toBe(3);
    expect(affected).toBe(2);
    expect(gaps.map((gap) => [gap.key, gap.count])).toEqual([
      ["rolece", 2],
      ["iso27001", 1],
      ["region:Cataluña", 1],
    ]);
    expect(gaps[2].action).toEqual({ kind: "add-region", label: "Add Cataluña", region: "Cataluña" });
  });

  it("puts the quicker fix first when counts tie", () => {
    const { gaps } = computeGaps(
      [{ tender_id: "a", reasons: [reason("warn", "Register in ROLECE: many tenders require it by the deadline")] }],
      { ...company, annual_turnover: null },
    );
    expect(gaps.map((gap) => gap.key)).toEqual(["turnover-missing", "rolece"]);
  });

  it("flags a missing turnover against every match", () => {
    const { gaps } = computeGaps(
      [{ tender_id: "a", reasons: [] }, { tender_id: "b", reasons: [] }],
      { ...company, annual_turnover: null },
    );
    expect(gaps).toEqual([expect.objectContaining({ key: "turnover-missing", count: 2 })]);
  });
});
