import { describe, expect, it } from "vitest";
import { partnerCards, type PartnerCandidate } from "./partners";

const row = (over: Partial<PartnerCandidate> = {}): PartnerCandidate => ({
  nif: "B12345678",
  name: "ADELANTE SERVICIOS INFORMATICOS S.L.",
  similar_wins: 2,
  best_similarity: 0.72,
  regions: ["Comunitat Valenciana"],
  same_region: true,
  largest_similar_award: 14082,
  covers_experience: true,
  total_awards: 4,
  is_sme: true,
  last_win: "2026-07-10",
  examples: [{ title: "Aplicación de gestión del cementerio", buyer: "Ayuntamiento de El Campello", amount: 14082, date: "2026-07-10" }],
  ...over,
});

describe("partnerCards", () => {
  it("summarises why a company is a good partner", () => {
    const [card] = partnerCards([row()]);
    expect(card.name).toBe("Adelante Servicios Informaticos S.L.");
    expect(card.tags).toEqual(["Same region", "Proves experience", "SME"]);
    expect(card.detail).toBe("Won 2 similar contracts · largest €14,082 · last Jul 2026");
    expect(card.example).toEqual({ title: "Aplicación de gestión del cementerio", buyer: "Ayuntamiento de El Campello" });
  });

  it("leaves out what isn't known", () => {
    const [card] = partnerCards([
      row({ similar_wins: 1, same_region: false, covers_experience: null, is_sme: null, largest_similar_award: null, last_win: null, examples: null }),
    ]);
    expect(card.tags).toEqual([]);
    expect(card.detail).toBe("Won 1 similar contract");
    expect(card.example).toBeNull();
  });

  it("keeps the order and the limit", () => {
    const cards = partnerCards(Array.from({ length: 8 }, (_, i) => row({ nif: `N${i}` })), 3);
    expect(cards.map((card) => card.key)).toEqual(["N0", "N1", "N2"]);
  });
});
