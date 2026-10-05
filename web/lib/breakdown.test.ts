import { describe, expect, it } from "vitest";
import { buildBreakdown, citeFor } from "./breakdown";

const documents = [
  { kind: "pcap", name: "Pliego Administrativo.pdf", url: "https://x/pcap" },
  { kind: "ppt", name: "PPT.pdf", url: "https://x/ppt" },
];

describe("citeFor", () => {
  it("links a cited page of the admin terms", () => {
    expect(citeFor({ doc: "pcap__Pliego Administrativo", page: 14, verified: true, quote: "Anexo II" }, documents)).toEqual({
      label: "Admin terms p.14",
      page: 14,
      href: "https://x/pcap#page=14",
      verified: true,
      quote: "Anexo II",
    });
  });

  it("marks facts that come from the notice data", () => {
    expect(citeFor({ doc: "placsp_xml", page: 0, verified: true }, documents)?.label).toBe("Notice data");
  });

  it("has no link when the document isn't listed", () => {
    expect(citeFor({ doc: "general__Acta", page: 2 }, documents)?.href).toBeNull();
  });
});

describe("buildBreakdown from a checklist", () => {
  const checklist = {
    eligibility: [{ category: "registry", requirement_en: "Must be in ROLECE.", threshold: null, doc: "pcap__P", page: 15, verified: true }],
    award_criteria: [
      { name: "Price", kind: "price", points: 70, how_scored_en: "Proportional", doc: "pcap__P", page: 19 },
      { name: "SLA", kind: "automatic_formula", points: 20, how_scored_en: "Bands", doc: "pcap__P", page: 20 },
      { name: "Proposal", kind: "judgement", points: 10, how_scored_en: "Panel", doc: "pcap__P", page: 21 },
    ],
    mandatory_documents: [
      { name: "DEUC", when: "with_bid", doc: "pcap__P", page: 14 },
      { name: "Deeds", when: "awardee_only", doc: "pcap__P", page: 26 },
    ],
    exclusion_risks: [{ risk_en: "Price above budget", doc: "pcap__P", page: 19 }],
    review_notes: ["Contradiction on ENS level"],
  };

  it("splits must-meet, formula and judgement criteria", () => {
    const b = buildBreakdown({ checklist, criteria: [], requirements: [], documents });
    expect(b.source).toBe("checklist");
    expect(b.mustMeet.map((i) => i.text)).toEqual(["Registration: Must be in ROLECE."]);
    expect(b.totals).toEqual({ price: 70, formula: 20, judgement: 10 });
    expect(b.submitWithBid.map((i) => i.text)).toEqual(["DEUC"]);
    expect(b.submitIfWin.map((i) => i.text)).toEqual(["Deeds"]);
    expect(b.exclusions[0].cite?.href).toBe("https://x/pcap#page=19");
    expect(b.watchOut).toEqual(["Contradiction on ENS level"]);
  });
});

describe("buildBreakdown from the notice data", () => {
  it("uses whole-contract criteria and skips generic declarations", () => {
    const b = buildBreakdown({
      checklist: null,
      criteria: [
        { type: "OBJ", subtype: "1", weight: "60", lot_id: null, description: "Precio" },
        { type: "OBJ", subtype: "2", weight: 15, lot_id: null, description: "Plazo" },
        { type: "SUBJ", subtype: null, weight: 25, lot_id: null, description: "Memoria técnica" },
        { type: "OBJ", subtype: "1", weight: 90, lot_id: "1", description: "Precio lote 1" },
      ],
      requirements: [
        { kind: "declaration", description: "Capacidad de obrar", threshold: null, lot_id: null },
        { kind: "financial_solvency", description: "Volumen anual de negocios igual o superior a 1,5 veces. Se acreditará mediante cuentas.", threshold: 150000, lot_id: null },
      ],
      documents,
    });
    expect(b.source).toBe("notice");
    expect(b.totals).toEqual({ price: 60, formula: 15, judgement: 25 });
    expect(b.mustMeet).toEqual([
      { text: "Financial solvency: Volumen anual de negocios igual o superior a 1,5 veces.", detail: "Threshold: 150,000", points: null, cite: null },
    ]);
    expect(b.lotNote).toBeNull();
  });

  it("falls back to the first lot when there are only lot criteria", () => {
    const b = buildBreakdown({
      checklist: null,
      criteria: [
        { type: "OBJ", subtype: "1", weight: 80, lot_id: "2" },
        { type: "OBJ", subtype: "1", weight: 70, lot_id: "1" },
      ],
      requirements: [],
      documents,
    });
    expect(b.totals.price).toBe(70);
    expect(b.lotNote).toBe("Showing lot 1; other lots may differ.");
  });
});
