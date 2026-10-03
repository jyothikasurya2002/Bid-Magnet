"use client";

import { useEffect, useRef, useState } from "react";
import { computeGaps, type Gap, type GapAction } from "@/lib/gaps";
import { createClient } from "@/lib/supabase/client";
import type { CompanyProfile, MatchReason } from "@/lib/types";

type GapRailProps = {
  company: CompanyProfile;
  revision: number;
  onAction: (action: GapAction) => void;
};

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; gaps: Gap[]; affected: number; total: number };

const MORE_VISIBLE = 4;

// Right panel: the one fix that frees the most open tenders, then the rest.
export function GapRail({ company, revision, onAction }: GapRailProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [showAll, setShowAll] = useState(false);
  const [fixed, setFixed] = useState<Gap | null>(null);
  const previous = useRef<Gap[] | null>(null);
  const companyId = company.id;

  useEffect(() => {
    if (!companyId) return;
    // Earlier counts stay on screen until the recount arrives.
    let cancelled = false;

    createClient()
      .rpc("match_tenders", { p_company: companyId, p_limit: 1000 })
      .then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
        if (cancelled) return;
        if (error) {
          setState({ kind: "error", message: error.message });
          return;
        }
        const rows = (data as Array<{ tender_id: string; reasons: MatchReason[] }>) || [];
        const next = computeGaps(rows, company);
        // A gap that disappeared after an edit is one the user just fixed.
        const solved = previous.current?.find(
          (gap) => !next.gaps.some((current) => current.key === gap.key),
        );
        setFixed(solved ?? null);
        previous.current = next.gaps;
        setState({ kind: "ready", ...next });
      });

    return () => {
      cancelled = true;
    };
    // Recount after every saved change; `company` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, revision]);

  const gaps = state.kind === "ready" ? state.gaps : [];
  const [best, ...rest] = gaps;
  const more = showAll ? rest : rest.slice(0, MORE_VISIBLE);

  return (
    <aside className="gap-rail" aria-labelledby="gap-rail-title">
      <div className="gap-rail-head">
        <h2 id="gap-rail-title">Your next best fix</h2>
        <p>
          {state.kind === "ready" && state.total
            ? `${state.total} open tenders match your services. ${state.affected} are held back by something in your profile.`
            : "What in your profile holds back the open tenders that match you."}
        </p>
      </div>

      {fixed ? (
        <p className="gap-fixed" role="status">
          <span aria-hidden="true">✓</span> {fixed.title} sorted. {fixed.count} tender
          {fixed.count === 1 ? "" : "s"} no longer held back by it.
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <p className="gap-rail-note" role="status">
          <span className="spinner" aria-hidden="true" /> Checking today&apos;s open tenders…
        </p>
      ) : null}

      {state.kind === "error" ? (
        <p className="gap-rail-note" role="alert">
          Couldn&apos;t check open tenders: {state.message}
        </p>
      ) : null}

      {state.kind === "ready" && !state.total ? (
        <p className="gap-rail-note">
          No open tenders match yet. Describe what you do and add sector codes or keywords
          to start matching.
        </p>
      ) : null}

      {state.kind === "ready" && state.total && !best ? (
        <p className="gap-rail-note">
          Nothing in your profile is holding back your {state.total} matching open tenders.
        </p>
      ) : null}

      {best ? (
        <div className="best-fix">
          <span className="best-fix-count">{best.count}</span>
          <span className="best-fix-unit">
            open tender{best.count === 1 ? "" : "s"} held back
          </span>
          <strong>{best.title}</strong>
          <p>{best.detail}</p>
          <button
            type="button"
            className="button button-dark button-full"
            onClick={() => onAction(best.action)}
          >
            {best.action.label}
          </button>
        </div>
      ) : null}

      {more.length ? (
        <div className="more-fixes">
          <h3>Then</h3>
          <ul>
            {more.map((gap) => (
              <li key={gap.key}>
                <span className="more-fix-count">{gap.count}</span>
                <span className="more-fix-title">{gap.title}</span>
                <button type="button" className="link-button link-strong" onClick={() => onAction(gap.action)}>
                  {gap.action.label}
                </button>
              </li>
            ))}
          </ul>
          {rest.length > MORE_VISIBLE ? (
            <button type="button" className="link-button" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show ${rest.length - MORE_VISIBLE} more`}
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="gap-rail-footnote">
        Counts open tenders matched on your sector codes, keywords or description. They
        update as you edit.
      </p>
    </aside>
  );
}
