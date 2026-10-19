import { describe, expect, it } from "vitest";
import type { Breakdown, BreakdownItem } from "./breakdown";
import { buildOutline, matchingCertificates, outlineMarkdown } from "./draft-outline";

const item = (text: string, points: number | null, detail: string | null = null): BreakdownItem => ({ text, detail, points, cite: null });

const breakdown = (over: Partial<Breakdown> = {}): Breakdown => ({
  source: "notice",
  mustMeet: [],
  price: [item("Oferta económica", 40)],
  formula: [item("Esquema Nacional de Seguridad", 10)],
  judgement: [item("Metodología y plan de trabajo", 30), item("Equipo de trabajo", 20)],
  totals: { price: 40, formula: 10, judgement: 50 },
  submitWithBid: [item("DEUC", null)],
  submitIfWin: [],
  exclusions: [],
  watchOut: [],
  lotNote: null,
  ...over,
});

const company = { name: "Acme", description: "Web and cloud developers", certifications: ["ENS_MEDIA", "ISO9001"], keywords: [], employees: 12 };

describe("proposal outline", () => {
  it("puts the overview first, then judgement by points, then formula criteria", () => {
    const outline = buildOutline(breakdown(), company);
    expect(outline.sections.map((s) => s.title)).toEqual([
      "Company overview",
      "Metodología y plan de trabajo",
      "Equipo de trabajo",
      "Esquema Nacional de Seguridad",
    ]);
    expect(outline.attach).toEqual(["DEUC"]);
    expect(outline.note).toContain("outweigh price");
  });

  it("suggests content by theme and links company certificates", () => {
    const [, method, team, ens] = buildOutline(breakdown(), company).sections;
    expect(method.gaps).toContain("[ADD: timeline with dates per phase]");
    expect(team.write.join(" ")).toContain("roles");
    expect(ens.evidence).toEqual(["You hold ENS MEDIA"]);
    expect(ens.write[0]).toContain("exact commitment");
  });

  it("says when nothing is scored by judgement", () => {
    const outline = buildOutline(breakdown({ judgement: [], totals: { price: 90, formula: 10, judgement: 0 } }), company);
    expect(outline.note).toContain("Nothing here is scored by judgement");
  });

  it("matches certificates on whole words only", () => {
    expect(matchingCertificates("Certificación ISO 9001 vigente", ["ISO9001", "ISO27001"])).toEqual(["ISO9001"]);
    expect(matchingCertificates("Pensiones y dispensas", ["ENS_ALTA"])).toEqual([]);
  });

  it("exports as Markdown", () => {
    const md = outlineMarkdown("Portal web", buildOutline(breakdown(), company));
    expect(md).toContain("# Technical proposal: Portal web");
    expect(md).toContain("## Metodología y plan de trabajo (30 pts)");
    expect(md).toContain("## Attach with the bid");
  });
});
