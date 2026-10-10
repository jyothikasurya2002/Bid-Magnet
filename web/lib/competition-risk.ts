// "A dedo" check: signs that a tender is already meant for someone, so bidding is likely a
// waste of time. Red flags follow the corruption-risk literature (Fazekas & Kocsis), kept
// only where they predicted single bidding or a repeat winner in our own data.
//
// Calibrated on 26,372 past awards (October 2026): one bid in 43% of awards overall.
// - Negotiated without publication: 95% single bid. Emergency procedure: 84%.
//   "Licitación con negociación": 77%. "Negociado con publicidad": 54%.
// - Buyer whose median award draws one bidder: 50% single bid at its next open tender,
//   against 19% where 3+ usually bid.
// - One company holding 60%+ of a buyer's awards won the next one 63% of the time;
//   40-60%: 24%; 25-40%: 17%. Normally 6%.
// - Both (one-bid buyer and a 40%+ favourite): the favourite won alone 28% of the time,
//   against 4% normally. A one-bid buyer without a favourite barely moves that (6%): few
//   bidders on its own is an opportunity (Discover's "Few bidders" filter), not a warning.
// Not used, because they didn't predict anything here: "urgent" procedures and the share of
// judgement-based points. Submission window: no reliable publication date yet.

export type BuyerRecord = {
  awards: number;
  medianBidders: number | null;
  topWinner: { name: string | null; nif: string | null; wins: number } | null;
};

export type RiskSignal = {
  key: "no_call" | "emergency" | "negotiated" | "favourite";
  level: "high" | "medium";
  text: string; // what we saw, for this tender
  evidence: string; // how often this ended badly in past tenders
};

export type CompetitionRisk = {
  level: "high" | "watch";
  score: number; // 0-100
  label: string;
  signals: RiskSignal[];
};

const MIN_AWARDS = 6; // fewer past awards say too little about a buyer

const PROCEDURES: Record<string, { level: RiskSignal["level"]; text: string; evidence: string }> = {
  "Negociado sin publicidad": {
    level: "high",
    text: "Negotiated without a public call",
    evidence: "95% of contracts awarded this way had a single bidder.",
  },
  "Licitación con negociación": {
    level: "medium",
    text: "Negotiated procedure",
    evidence: "77% of contracts awarded this way had a single bidder.",
  },
  "Negociado con publicidad": {
    level: "medium",
    text: "Negotiated procedure",
    evidence: "Over half of contracts awarded this way had a single bidder.",
  },
};

const POINTS: Record<RiskSignal["level"], number> = { high: 60, medium: 30 };

const normalizeNif = (nif: string | null | undefined) => (nif ?? "").replace(/[\s.-]/g, "").toUpperCase();

export function competitionRisk(input: {
  procedure: string | null;
  urgency: string | null; // PLACSP urgency code: 1 ordinary, 2 urgent, 3 emergency
  buyer: BuyerRecord | null;
  companyNif?: string | null; // your own wins at a buyer aren't a warning
}): CompetitionRisk | null {
  const signals: RiskSignal[] = [];

  const procedure = input.procedure ? PROCEDURES[input.procedure] : undefined;
  if (procedure) signals.push({ key: procedure.level === "high" ? "no_call" : "negotiated", ...procedure });
  if (input.urgency === "3") {
    signals.push({ key: "emergency", level: "high", text: "Emergency procedure", evidence: "84% of emergency contracts had a single bidder." });
  }

  const buyer = input.buyer;
  if (buyer && buyer.awards >= MIN_AWARDS) {
    const top = buyer.topWinner;
    const share = top ? top.wins / buyer.awards : 0;
    const mine = top?.nif && input.companyNif && normalizeNif(top.nif) === normalizeNif(input.companyNif);
    const lonely = buyer.medianBidders !== null && buyer.medianBidders <= 1;
    if (top && share >= 0.25 && !mine) {
      const strong = share >= 0.6 || (share >= 0.4 && lonely);
      signals.push({
        key: "favourite",
        level: strong ? "high" : "medium",
        text: `${top.name || "One company"} won ${top.wins} of this buyer’s ${buyer.awards} contracts${lonely ? ", and most of its contracts drew a single bid" : ""}`,
        evidence:
          share >= 0.6
            ? "When one company holds most of a buyer’s contracts, it won the next one 63% of the time (6% normally)."
            : strong
              ? "At buyers like this, the favourite won alone 28% of the time (4% normally)."
              : share >= 0.4
                ? "When one company holds this much of a buyer’s contracts, it won the next one about 1 in 4 times (6% normally)."
                : "When one company holds this much of a buyer’s contracts, it won the next one about 1 in 6 times (6% normally).",
      });
    }
  }

  if (!signals.length) return null;
  const score = Math.min(100, signals.reduce((total, signal) => total + POINTS[signal.level], 0));
  const level = score >= 60 ? "high" : "watch";
  return { level, score, label: level === "high" ? "Looks pre-arranged" : "Some warning signs", signals };
}

/** buyer_stats row → the fields the check needs. */
export function buyerRecord(row: {
  awards: number | string | null;
  median_bidders: number | string | null;
  top_winners: Array<{ name: string | null; nif: string | null; wins: number }> | null;
}): BuyerRecord {
  const top = row.top_winners?.[0];
  return {
    awards: Number(row.awards) || 0,
    medianBidders: row.median_bidders === null ? null : Number(row.median_bidders),
    topWinner: top ? { name: top.name, nif: top.nif, wins: Number(top.wins) || 0 } : null,
  };
}
