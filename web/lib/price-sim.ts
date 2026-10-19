// Price simulator for Bid prep: "if we bid X, how many price points do we get, and would we
// be flagged as abnormally low?" Pure functions, no I/O, so the UI (sliders, charts) can
// call them on every keystroke.
//
// Everything works in DISCOUNTS: d = 1 - offer / budget (0.12 = 12% below the budget,
// excluding VAT). Spanish rules speak of "unidades porcentuales", i.e. percentage points
// of discount, so comparisons below are in discount points.

export type FormulaKind =
  | "lowest_ratio" // P = max × lowest offer / your offer           (most common)
  | "discount_ratio" // P = max × your discount / biggest discount  (e.g. the cemetery tender)
  | "linear" // P = max × (budget − offer) / (budget − lowest offer)
  | "logarithmic"; // P = max × log(lowest offer) / log(your offer) (e.g. the chatbot tender)

export type AbnormalRule =
  | { kind: "rglcap85" } // legal default (art. 85 RGLCAP), depends on the number of bidders
  | { kind: "below_mean"; points: number } // > N points of discount above the average discount
  | { kind: "below_budget"; points: number } // > N points below the budget
  | { kind: "none" };

export type PriceSetup = {
  budget: number; // base budget excl. VAT
  maxPoints: number; // points the price criterion is worth
  formula: FormulaKind;
  maxDiscount: number | null; // cap: discounts above it score 0 (chatbot: 0.20); null = none
  abnormal: AbnormalRule;
};

export const FORMULA_LABEL: Record<FormulaKind, string> = {
  lowest_ratio: "Lowest offer ÷ your offer",
  discount_ratio: "Your discount ÷ biggest discount",
  linear: "Linear between budget and lowest offer",
  logarithmic: "Logarithmic (price differences count less)",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const offerFor = (budget: number, d: number) => budget * (1 - d);

/** Price points for one offer, given the best (largest) admitted discount in the race. */
export function pricePoints(setup: PriceSetup, discount: number, bestDiscount: number): number {
  const { budget, maxPoints } = setup;
  if (setup.maxDiscount !== null && discount > setup.maxDiscount + 1e-9) return 0;
  const best = Math.max(bestDiscount, discount);
  if (discount <= 0) return setup.formula === "lowest_ratio" || setup.formula === "logarithmic" ? ratioAtZero(setup, best) : 0;
  const offer = offerFor(budget, discount);
  const lowest = offerFor(budget, best);
  let points: number;
  switch (setup.formula) {
    case "lowest_ratio":
      points = maxPoints * (lowest / offer);
      break;
    case "discount_ratio":
      points = maxPoints * (discount / best);
      break;
    case "linear":
      points = best > 0 ? maxPoints * ((budget - offer) / (budget - lowest)) : maxPoints;
      break;
    case "logarithmic":
      points = maxPoints * (Math.log10(lowest) / Math.log10(offer));
      break;
  }
  return round2(Math.min(maxPoints, Math.max(0, points)));
}

// Bidding exactly the budget still scores under ratio formulas.
function ratioAtZero(setup: PriceSetup, best: number) {
  const lowest = offerFor(setup.budget, best);
  const p =
    setup.formula === "lowest_ratio"
      ? setup.maxPoints * (lowest / setup.budget)
      : setup.maxPoints * (Math.log10(lowest) / Math.log10(setup.budget));
  return round2(Math.min(setup.maxPoints, Math.max(0, p)));
}

/**
 * Which offers are presumed abnormally low. `discounts` = every admitted offer (yours included).
 * Art. 85 RGLCAP, applied on discount points:
 *  1 bidder: > 25 points below budget · 2 bidders: > 20 points below the other offer ·
 *  3 bidders: > 10 points above the average discount (the dearest offer is left out of the
 *  average if it is > 10 points dearer than it), and always if > 25 points ·
 *  4+ bidders: > 10 points above the average; offers > 10 points dearer than the average
 *  are left out and the average recomputed (if fewer than 3 remain, the 3 cheapest are used).
 */
export function abnormalFlags(rule: AbnormalRule, discounts: number[]): boolean[] {
  const pts = discounts.map((d) => d * 100);
  if (rule.kind === "none") return pts.map(() => false);
  if (rule.kind === "below_budget") return pts.map((p) => p > rule.points);
  if (rule.kind === "below_mean") {
    const mean = avg(pts);
    return pts.map((p) => p > mean + rule.points);
  }
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) return [pts[0] > 25];
  if (n === 2) return [pts[0] > pts[1] + 20, pts[1] > pts[0] + 20];
  if (n === 3) {
    let mean = avg(pts);
    const dearest = Math.min(...pts);
    if (dearest < mean - 10) {
      const rest = [...pts];
      rest.splice(rest.indexOf(dearest), 1);
      mean = avg(rest);
    }
    return pts.map((p) => p > mean + 10 || p > 25);
  }
  let mean = avg(pts);
  const kept = pts.filter((p) => p >= mean - 10);
  if (kept.length !== n) {
    mean = kept.length >= 3 ? avg(kept) : avg([...pts].sort((a, b) => b - a).slice(0, 3));
  }
  return pts.map((p) => p > mean + 10);
}

/** The largest discount you could offer without being presumed abnormal, given the rivals. */
export function abnormalLimit(rule: AbnormalRule, rivals: number[], step = 0.0025): number | null {
  if (rule.kind === "none") return null;
  let safe: number | null = null;
  for (let d = 0; d <= 0.9 + 1e-9; d += step) {
    if (abnormalFlags(rule, [round4(d), ...rivals])[0]) break;
    safe = round4(d);
  }
  return safe;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
function avg(values: number[]) {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export type Market = {
  rivals: number[]; // assumed rival discounts
  typical: number | null; // median winning discount in the history
  aggressive: number | null; // 75th percentile: a sharp rival
  bidders: number; // total bidders assumed, you included
  basis: string; // where the assumptions come from, for the UI
};

/**
 * Rival assumptions from past winning discounts (this buyer + similar tenders) and the
 * typical number of bidders. Rivals are spread across the history so the race looks like
 * past ones; with no history we assume 10% with one sharper rival at 20%.
 */
export function marketFrom(history: number[], medianBidders: number | null): Market {
  const clean = history.filter((d) => Number.isFinite(d) && d >= -0.05 && d <= 0.9);
  const bidders = Math.max(2, Math.min(12, Math.round(medianBidders ?? 3)));
  const n = bidders - 1;
  if (clean.length < 3) {
    const rivals = Array.from({ length: n }, (_, i) => (i === 0 ? 0.2 : 0.1));
    return { rivals, typical: null, aggressive: null, bidders, basis: "No price history here: assuming rivals around 10%, one at 20%." };
  }
  const rivals = Array.from({ length: n }, (_, i) => round4(quantile(clean, n === 1 ? 0.75 : 0.25 + (0.5 * i) / (n - 1))!));
  return {
    rivals,
    typical: round4(quantile(clean, 0.5)!),
    aggressive: round4(quantile(clean, 0.75)!),
    bidders,
    basis: `Based on ${clean.length} past winning discounts and a typical ${bidders} bidders.`,
  };
}

export type SimRow = { discount: number; offer: number; points: number; abnormal: boolean; best: number };

/** Points and abnormal-low risk for each candidate discount, against the assumed rivals. */
export function simulate(setup: PriceSetup, rivals: number[], from = 0, to = 0.5, step = 0.01): SimRow[] {
  const rows: SimRow[] = [];
  for (let d = from; d <= to + 1e-9; d += step) {
    const discount = round4(d);
    const best = Math.max(discount, ...rivals.filter((r) => !aboveCap(setup, r)));
    rows.push({
      discount,
      offer: Math.round(offerFor(setup.budget, discount) * 100) / 100,
      points: pricePoints(setup, discount, best),
      abnormal: abnormalFlags(setup.abnormal, [discount, ...rivals])[0],
      best,
    });
  }
  return rows;
}

// A rival above the cap scores 0 and doesn't set the "best" reference under capped formulas.
function aboveCap(setup: PriceSetup, rival: number) {
  return setup.maxDiscount !== null && rival > setup.maxDiscount + 1e-9;
}

export type Advice = {
  safeMax: number | null; // largest discount not presumed abnormal
  sweetSpot: SimRow | null; // most points while staying safe
  atTypical: SimRow | null; // what bidding the typical winning discount gives you
  notes: string[];
};

export function advise(setup: PriceSetup, market: Market): Advice {
  const rows = simulate(setup, market.rivals);
  const safe = rows.filter((r) => !r.abnormal && r.points > 0);
  const safeMax = abnormalLimit(setup.abnormal, market.rivals);
  const sweetSpot = safe.reduce<SimRow | null>((best, r) => (!best || r.points > best.points + 0.004 ? r : best), null);
  const atTypical = market.typical !== null ? rows.reduce((a, r) => (Math.abs(r.discount - market.typical!) < Math.abs(a.discount - market.typical!) ? r : a)) : null;
  const notes: string[] = [];
  if (setup.formula === "logarithmic") notes.push("Logarithmic formula: big discounts gain very few extra points. Quality criteria decide.");
  if (setup.maxDiscount !== null) notes.push(`Discounts above ${Math.round(setup.maxDiscount * 100)}% score 0 price points.`);
  if (setup.formula === "discount_ratio") notes.push("Points depend on your discount relative to the biggest one: bidding the budget scores 0.");
  if (safeMax !== null) notes.push(`With these rivals, more than ${Math.round(safeMax * 100)}% off would be presumed abnormally low (you'd have to justify it).`);
  return { safeMax, sweetSpot, atTypical, notes };
}

/** Best guess of the formula from the checklist's price section (falls back to lowest_ratio). */
export function formulaFromChecklist(price: { formula?: string | null } | null | undefined): { formula: FormulaKind; maxDiscount: number | null; known: boolean } {
  const text = (price?.formula ?? "").toLowerCase();
  if (!text) return { formula: "lowest_ratio", maxDiscount: null, known: false };
  const cap = text.match(/max(?:imum)?\.?\s*discount\s*(\d+(?:[.,]\d+)?)\s*%|baja\s*(?:máxima|maxima)[^\d]*(\d+(?:[.,]\d+)?)\s*%/);
  const maxDiscount = cap ? Number((cap[1] ?? cap[2]).replace(",", ".")) / 100 : null;
  if (/log/.test(text)) return { formula: "logarithmic", maxDiscount, known: true };
  if (/bm[aá]x|baja|discount|b[iᵢ]\s*\/|b_i/.test(text)) return { formula: "discount_ratio", maxDiscount, known: true };
  if (/\(\s*(pbl|budget|presupuesto)\s*[-−]/.test(text)) return { formula: "linear", maxDiscount, known: true };
  return { formula: "lowest_ratio", maxDiscount, known: /min|lowest|m[aá]s baja|mo\b/.test(text) };
}

/** The abnormally-low rule from the checklist text; art. 85 RGLCAP is the legal default. */
export function abnormalFromChecklist(price: { abnormally_low_rule?: string | null } | null | undefined): AbnormalRule {
  const text = (price?.abnormally_low_rule ?? "").toLowerCase();
  if (!text || /rglcap|art(?:icle|\.)?\s*85/.test(text)) return { kind: "rglcap85" };
  const n = text.match(/(\d+(?:[.,]\d+)?)\s*(?:%|points|puntos|unidades)/);
  const points = n ? Number(n[1].replace(",", ".")) : null;
  if (points === null) return { kind: "rglcap85" };
  if (/average|mean|media/.test(text)) return { kind: "below_mean", points };
  if (/budget|presupuesto|licitaci/.test(text)) return { kind: "below_budget", points };
  return { kind: "rglcap85" };
}

/** Starting setup for the simulator from the tender: budget, price points, checklist text. */
export function setupFrom(input: {
  budget: number | string | null;
  pricePoints: number | null;
  price: { formula?: string | null; abnormally_low_rule?: string | null } | null;
}): PriceSetup & { formulaKnown: boolean } {
  const guess = formulaFromChecklist(input.price);
  return {
    budget: Number(input.budget) > 0 ? Number(input.budget) : 100_000,
    maxPoints: input.pricePoints && input.pricePoints > 0 ? input.pricePoints : 100,
    formula: guess.formula,
    maxDiscount: guess.maxDiscount,
    abnormal: abnormalFromChecklist(input.price),
    formulaKnown: guess.known,
  };
}
