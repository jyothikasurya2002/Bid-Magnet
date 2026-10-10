import { describe, expect, it } from "vitest";
import { buyerRecord, competitionRisk } from "./competition-risk";

const buyer = (awards: number, medianBidders: number | null, wins: number, nif = "B12345678") => ({
  awards,
  medianBidders,
  topWinner: { name: "Acme SL", nif, wins },
});

describe("competition risk", () => {
  it("says nothing about an ordinary open tender", () => {
    expect(competitionRisk({ procedure: "Abierto", urgency: "1", buyer: buyer(20, 3, 3) })).toBeNull();
    expect(competitionRisk({ procedure: "Abierto", urgency: "2", buyer: null })).toBeNull(); // "urgent" isn't a flag
  });

  it("flags awards without a public call or in an emergency as high", () => {
    expect(competitionRisk({ procedure: "Negociado sin publicidad", urgency: "1", buyer: null })).toMatchObject({ level: "high", label: "Looks pre-arranged" });
    expect(competitionRisk({ procedure: "Abierto", urgency: "3", buyer: null })?.signals[0].key).toBe("emergency");
  });

  it("flags a buyer's favourite company by its share of awards", () => {
    const medium = competitionRisk({ procedure: "Abierto", urgency: "1", buyer: buyer(10, 2, 4) });
    expect(medium).toMatchObject({ level: "watch", score: 30 });
    expect(medium?.signals[0].text).toBe("Acme SL won 4 of this buyer’s 10 contracts");
    expect(competitionRisk({ procedure: "Abierto", urgency: "1", buyer: buyer(10, 2, 7) })?.level).toBe("high");
    // A one-bid buyer with a 40%+ favourite is the strongest combination; one bid alone isn't a warning.
    const both = competitionRisk({ procedure: "Abierto", urgency: "1", buyer: buyer(10, 1, 4) });
    expect(both).toMatchObject({ level: "high", score: 60 });
    expect(both?.signals[0].text).toBe("Acme SL won 4 of this buyer’s 10 contracts, and most of its contracts drew a single bid");
    expect(competitionRisk({ procedure: "Abierto", urgency: "1", buyer: buyer(10, 1, 2) })).toBeNull();
    expect(competitionRisk({ procedure: "Abierto", urgency: "1", buyer: buyer(12, 1, 3) })).toMatchObject({ level: "watch", score: 30 });
    // Stacked signals add up.
    expect(competitionRisk({ procedure: "Licitación con negociación", urgency: "1", buyer: buyer(10, 2, 4) })?.score).toBe(60);
  });

  it("ignores small buyers and your own wins", () => {
    expect(competitionRisk({ procedure: "Abierto", urgency: "1", buyer: buyer(4, 1, 4) })).toBeNull();
    const mine = competitionRisk({ procedure: "Abierto", urgency: "1", buyer: buyer(10, 2, 8, "B-1234567-8"), companyNif: "b12345678" });
    expect(mine).toBeNull();
  });

  it("reads buyer_stats rows", () => {
    expect(buyerRecord({ awards: "12", median_bidders: "1", top_winners: [{ name: "X", nif: null, wins: 5 }] })).toEqual({
      awards: 12,
      medianBidders: 1,
      topWinner: { name: "X", nif: null, wins: 5 },
    });
    expect(buyerRecord({ awards: null, median_bidders: null, top_winners: [] }).topWinner).toBeNull();
  });
});
