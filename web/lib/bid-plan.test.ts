import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlan, dayIndex, envelopeToken, myTasks, planDays, progress, taskSpan, type Checklist, type PlanInput } from "./bid-plan";

const checklist = (id: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "..", "data-pipeline", "out", "extractions", `${id}.json`), "utf8")) as Checklist;

const base: PlanInput = {
  today: "2026-10-05",
  deadline: "2026-10-20",
  platform: "PLACSP",
  checklist: null,
  criteria: [],
  requirements: [],
  company: { rolece_status: "active", classification_status: "unknown", certifications: ["ISO 27001"], annual_turnover: 500_000 },
  vault: [],
};

describe("bid plan", () => {
  it("lays out business days to the deadline", () => {
    const days = planDays("2026-10-09", "2026-10-14");
    expect(days).toEqual(["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"]);
    expect(dayIndex(days, "2026-10-11")).toBe(0);
    expect(planDays("2026-10-10", "2026-10-10")).toEqual(["2026-10-10"]);
  });

  it("reads envelope names", () => {
    expect(envelopeToken("Sobre UNO – Documentación administrativa")).toBe("1");
    expect(envelopeToken("Sobre 2")).toBe("2");
    expect(envelopeToken("Sobre DOS – Oferta económica")).toBe("2");
    expect(envelopeToken("Archivo electrónico único")).toBe("single");
    expect(envelopeToken(null)).toBeNull();
  });

  it("builds the plan from a cited checklist", () => {
    const plan = buildPlan({ ...base, checklist: checklist("20586307"), deadline: "2026-10-09" });
    expect(plan.source).toBe("checklist");
    const labels = plan.groups.map((group) => group.label);
    expect(labels[0]).toBe("Before you start");
    expect(labels).toContain("Envelope 1 · Documentación administrativa");
    expect(labels.at(-1)).toBe("Sign & submit");

    const second = plan.groups.find((group) => group.label.startsWith("Envelope 2"))!;
    expect(second.tasks.some((task) => task.kind === "price")).toBe(true);
    expect(second.points).toBe(120); // all lots' criteria are listed

    const ute = plan.groups.flatMap((group) => group.tasks).find((task) => /UTE/.test(task.title))!;
    expect(ute.conditional).toBe(true);
    expect(plan.afterAward.length).toBeGreaterThan(3);
    expect(plan.questionsBy).toBe("2026-10-08");

    for (const task of plan.groups.flatMap((group) => group.tasks)) {
      expect(task.start).toBeGreaterThanOrEqual(0);
      expect(task.end).toBeLessThan(plan.days.length);
      expect(task.start).toBeLessThanOrEqual(task.end);
    }
    const submit = plan.groups.at(-1)!.tasks.at(-1)!;
    expect(submit.end).toBe(plan.days.length - 1);
  });

  it("asks the buyer about contradictions before the questions deadline", () => {
    const plan = buildPlan({ ...base, checklist: checklist("20602902") });
    const clarify = plan.groups[0].tasks.find((task) => task.kind === "clarify")!;
    expect(clarify.title).toMatch(/clarify \d+ points/);
    expect(plan.clarifications.length).toBeGreaterThan(1);
    const rolece = plan.groups[0].tasks.find((task) => task.title === "Registry certificate")!;
    expect(rolece.check).toBe("met");
    const ens = plan.groups[0].tasks.find((task) => task.title === "Certification")!;
    expect(ens.check).toBe("missing");
    expect(plan.price?.abnormallyLow).toMatch(/RGLCAP/);
    expect(ens.facts.find((fact) => fact.label === "Your profile")).toEqual({ label: "Your profile", value: "ISO 27001", tone: "warn" });
    expect(ens.facts.some((fact) => fact.label === "Alternative")).toBe(true);

    const tasks = plan.groups.flatMap((group) => group.tasks);
    const availability = tasks.find((task) => task.title.includes("B.1"))!;
    expect(availability.options).toEqual([
      { when: "≥ 99.90%", points: "5" },
      { when: "≥ 99.75%", points: "2.5" },
      { when: "≥ 99.50%", points: "0" },
    ]);
    expect(availability.facts[0]).toEqual({ label: "Points", value: "5 of 100 (5%)" });
    const annex = tasks.find((task) => task.title.startsWith("Anexo II"))!;
    expect(annex.facts.find((fact) => fact.label === "Template")?.value).toBe("Anexo II of the PCAP");
  });

  it("falls back to the notice data", () => {
    const plan = buildPlan({
      ...base,
      budget: 100_000,
      buyer: { medianDiscount: 0.15, medianBidders: 3 },
      criteria: [
        { type: "OBJ", subtype: "1", description: "Oferta económica", weight: "60" },
        { type: "OBJ", subtype: "2", description: "Reducción del plazo", weight: "20" },
        { type: "SUBJ", subtype: "99", description: "Memoria técnica", weight: "20" },
      ],
      requirements: [
        { kind: "declaration", code: "1", description: "Capacidad de obrar", threshold: null },
        { kind: "financial_solvency", code: "5", description: "Volumen anual de negocios", threshold: "300000" },
      ],
    });
    expect(plan.source).toBe("notice");
    expect(plan.groups.map((group) => group.key)).toEqual(["before", "admin", "judged", "formula", "finish"]);
    expect(plan.groups[0].tasks[0].check).toBe("met");
    expect(plan.groups.find((group) => group.key === "formula")!.tasks.map((task) => task.kind)).toEqual(["commitment", "price"]);
    expect(progress(plan, {})).toEqual({ done: 1, total: 7 });
    const priceTask = plan.groups.flatMap((group) => group.tasks).find((task) => task.kind === "price")!;
    expect(priceTask.facts.map((fact) => fact.value)).toEqual(["60 of 100 (60%)", "€100,000", "15% ≈ €85,000", "3"]);
    expect(plan.groups[0].tasks[0].facts).toEqual([
      { label: "Required", value: "€300,000" },
      { label: "Your profile", value: "Turnover €500,000", tone: "ok" },
    ]);

    const price = plan.groups.find((group) => group.key === "formula")!.tasks.find((task) => task.kind === "price")!;
    expect(taskSpan(price, { [price.id]: { start: "2026-10-01", end: "2026-10-02" } }, plan.days)).toEqual({ start: 0, end: 0, late: true });
    expect(taskSpan(price, { [price.id]: { status: "done", end: "2026-10-02" } }, plan.days).late).toBe(false);
    expect(taskSpan(price, { [price.id]: { start: "2026-10-07", end: "2026-10-09" } }, plan.days)).toEqual({ start: 2, end: 4, late: false });

    const tasks = plan.groups.flatMap((group) => group.tasks);
    const mine = myTasks(
      tasks,
      {
        [price.id]: { ownerId: "me", end: "2026-10-02" },
        [tasks[1].id]: { ownerId: "me", status: "done" },
        [tasks[2].id]: { ownerId: "someone-else" },
      },
      plan.days,
      "me",
    );
    expect(mine).toEqual([{ task: price, status: "todo", due: "2026-10-02", late: true }]);
  });
});
