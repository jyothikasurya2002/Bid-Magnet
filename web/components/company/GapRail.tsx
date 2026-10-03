"use client";

import { useEffect, useState } from "react";
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

const VISIBLE = 5;

export function GapRail({ company, revision, onAction }: GapRailProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [showAll, setShowAll] = useState(false);
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
        const rows = ((data as Array<{ tender_id: string; reasons: MatchReason[] }>) || []);
        setState({ kind: "ready", ...computeGaps(rows, company) });
      });

    return () => {
      cancelled = true;
    };
    // Recount after every saved change; `company` is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, revision]);

  const gaps = state.kind === "ready" ? state.gaps : [];
  const visible = showAll ? gaps : gaps.slice(0, VISIBLE);

  return (
    <aside className="gap-rail" aria-labelledby="gap-rail-title">
      <div className="gap-rail-head">
        <h2 id="gap-rail-title">Costing you matches</h2>
        <p>
          {state.kind === "ready" && state.total
            ? `${state.affected} of the ${state.total} open tenders that match your services are held back by something here.`
            : "Open tenders that match your services, and what in your profile holds them back."}
        </p>
      </div>

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
          No open tenders match yet. Add sector codes, keywords or a description under
          What you do.
        </p>
      ) : null}

      {state.kind === "ready" && state.total && !gaps.length ? (
        <p className="gap-rail-note">
          Nothing in your profile is holding back your {state.total} matching open tenders.
        </p>
      ) : null}

      {visible.map((gap) => (
        <div className="gap" key={gap.key}>
          <span className="gap-count">{gap.count}</span>
          <div className="gap-body">
            <strong>{gap.title}</strong>
            <span>{gap.detail}</span>
            <div>
              <button
                type="button"
                className="button button-dark button-small"
                onClick={() => onAction(gap.action)}
              >
                {gap.action.label}
              </button>
            </div>
          </div>
        </div>
      ))}

      {gaps.length > VISIBLE ? (
        <button type="button" className="link-button gap-more" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show ${gaps.length - VISIBLE} more`}
        </button>
      ) : null}

      <p className="gap-rail-footnote">
        Counts open tenders matched on your sector codes, keywords or description. They
        update as you edit.
      </p>
    </aside>
  );
}
