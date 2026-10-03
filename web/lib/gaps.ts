import type { CompanyProfile, MatchReason } from "./types";

// Rows of the company page a gap can send the user to.
export type FactId =
  | "turnover"
  | "rolece"
  | "classification"
  | "cert:ISO27001"
  | "cert:ISO9001"
  | "cert:ENS";

export type GapAction =
  | { kind: "edit"; label: string; fact: FactId }
  | { kind: "add-region"; label: string; region: string };

export type Gap = {
  key: string;
  count: number;
  title: string;
  detail: string;
  action: GapAction;
};

type MatchRow = { tender_id: string; reasons: MatchReason[] | null };

// Reasons come from match_tenders in data-pipeline/backend.sql; these
// prefixes must follow its wording.
const RULES: Array<{
  key: string;
  test: (reason: MatchReason) => boolean;
  title: string;
  detail: string;
  action: GapAction;
}> = [
  {
    key: "iso27001",
    test: (r) => r.type === "gap" && r.text.startsWith("Asks for ISO 27001"),
    title: "ISO 27001 not held",
    detail: "These tenders ask for it in their solvency or technical requirements.",
    action: { kind: "edit", label: "Add certificate", fact: "cert:ISO27001" },
  },
  {
    key: "ens",
    test: (r) => r.type === "gap" && r.text.startsWith("Mentions ENS"),
    title: "ENS not held",
    detail: "Public-sector systems often need an ENS conformity certificate.",
    action: { kind: "edit", label: "Add ENS", fact: "cert:ENS" },
  },
  {
    key: "iso9001",
    test: (r) => r.type === "gap" && r.text.startsWith("Asks for ISO 9001"),
    title: "ISO 9001 not held",
    detail: "Quality management certification is asked for in these tenders.",
    action: { kind: "edit", label: "Add certificate", fact: "cert:ISO9001" },
  },
  {
    key: "classification",
    test: (r) => r.type === "gap" && r.text.startsWith("Requires business classification"),
    title: "Business classification missing",
    detail: "These tenders list a classification requirement.",
    action: { kind: "edit", label: "Update classification", fact: "classification" },
  },
  {
    key: "turnover-low",
    test: (r) => r.type === "gap" && r.text.startsWith("Turnover may be below"),
    title: "Turnover below the solvency rule",
    detail: "Buyers usually ask for 1.5× the contract's annual value. Check your best year is entered.",
    action: { kind: "edit", label: "Review turnover", fact: "turnover" },
  },
  {
    key: "rolece",
    test: (r) => r.text.startsWith("Register in ROLECE"),
    title: "ROLECE not active",
    detail: "Many tenders require an active registration by the deadline.",
    action: { kind: "edit", label: "Update status", fact: "rolece" },
  },
];

// On equal counts the quicker fix goes first: typing a number beats getting certified.
const EFFORT: Record<string, number> = {
  "turnover-missing": 0,
  "turnover-low": 1,
  rolece: 3,
  classification: 3,
  iso27001: 3,
  iso9001: 3,
  ens: 3,
};
const effort = (gap: Gap) => EFFORT[gap.key] ?? 1; // regions: one click

const OUTSIDE_REGION = /^Outside your regions \((.+)\)$/;

export function computeGaps(matches: MatchRow[], company: CompanyProfile) {
  const counts = new Map<string, number>();
  const regionCounts = new Map<string, number>();
  const affected = new Set<string>();

  const bump = (map: Map<string, number>, key: string, tender: string) => {
    map.set(key, (map.get(key) ?? 0) + 1);
    affected.add(tender);
  };

  for (const match of matches) {
    const seen = new Set<string>();
    for (const reason of match.reasons ?? []) {
      const rule = RULES.find((candidate) => candidate.test(reason));
      if (rule && !seen.has(rule.key)) {
        seen.add(rule.key);
        bump(counts, rule.key, match.tender_id);
      }
      const region = reason.text.match(OUTSIDE_REGION)?.[1];
      if (region && region !== "unknown" && region !== "Nacional" && !seen.has(region)) {
        seen.add(region);
        bump(regionCounts, region, match.tender_id);
      }
    }
  }

  const gaps: Gap[] = RULES.filter((rule) => counts.get(rule.key)).map((rule) => ({
    key: rule.key,
    count: counts.get(rule.key)!,
    title: rule.title,
    detail: rule.detail,
    action: rule.action,
  }));

  // Without a turnover the backend skips the solvency check entirely.
  if (company.annual_turnover === null && matches.length) {
    matches.forEach((match) => affected.add(match.tender_id));
    gaps.push({
      key: "turnover-missing",
      count: matches.length,
      title: "Turnover not entered",
      detail: "We can't check economic solvency for any tender without it.",
      action: { kind: "edit", label: "Enter amount", fact: "turnover" },
    });
  }

  for (const [region, count] of regionCounts) {
    gaps.push({
      key: `region:${region}`,
      count,
      title: `${region} not in your regions`,
      detail: `Matching tenders from ${region} score lower.`,
      action: { kind: "add-region", label: `Add ${region}`, region },
    });
  }

  gaps.sort((a, b) => b.count - a.count || effort(a) - effort(b));
  return { gaps, affected: affected.size, total: matches.length };
}
