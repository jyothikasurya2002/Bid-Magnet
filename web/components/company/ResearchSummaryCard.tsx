"use client";

import { useState, useSyncExternalStore } from "react";
import { researchSummaryKey, type ResearchSummary } from "@/lib/research-fill";
import type { ImportSuggestion } from "@/lib/types";
import { SuggestionRow } from "./SuggestionRow";

type ResearchSummaryCardProps = {
  companyId: string;
  onApply: (suggestion: ImportSuggestion) => Promise<boolean>;
};

const noop = () => () => {};

// "Here's what we filled in", shown once after the first-run research.
export function ResearchSummaryCard({ companyId, onApply }: ResearchSummaryCardProps) {
  const raw = useSyncExternalStore(
    noop,
    () => {
      try {
        return sessionStorage.getItem(researchSummaryKey(companyId));
      } catch {
        return null;
      }
    },
    () => null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [decided, setDecided] = useState<Record<number, "used" | "skipped">>({});

  let summary: ResearchSummary | null = null;
  try {
    summary = raw ? (JSON.parse(raw) as ResearchSummary) : null;
  } catch {
    summary = null;
  }
  if (!summary || dismissed) return null;

  function dismiss() {
    try {
      sessionStorage.removeItem(researchSummaryKey(companyId));
    } catch {
      // nothing to clean up
    }
    setDismissed(true);
  }

  const open = summary.review.filter((_, index) => !decided[index]).length;

  return (
    <section className="research-summary" aria-labelledby="research-summary-title">
      <div className="research-summary-head">
        <div>
          <h2 id="research-summary-title">
            {summary.applied.length
              ? `We filled in ${summary.applied.length} fact${summary.applied.length === 1 ? "" : "s"} for you`
              : "We couldn't fill in anything automatically"}
          </h2>
          <p>
            From {summary.sources} source{summary.sources === 1 ? "" : "s"}. Everything below is
            editable, and each fact links to the page it came from.
            {open ? ` ${open} need${open === 1 ? "s" : ""} your call.` : ""}
          </p>
        </div>
        <button type="button" className="button button-dark button-small" onClick={dismiss}>
          Looks good
        </button>
      </div>

      {summary.applied.map((suggestion, index) => (
        <SuggestionRow key={`a${index}`} suggestion={suggestion} status="added" />
      ))}

      {summary.review.length ? <h3 className="research-summary-sub">Needs your call</h3> : null}
      {summary.review.map((suggestion, index) => (
        <SuggestionRow
          key={`r${index}`}
          suggestion={suggestion}
          status={decided[index]}
          onUse={async () => {
            if (await onApply(suggestion)) setDecided((current) => ({ ...current, [index]: "used" }));
          }}
          onSkip={() => setDecided((current) => ({ ...current, [index]: "skipped" }))}
        />
      ))}

      {summary.notFound.length ? (
        <p className="research-summary-foot">Not found online: {summary.notFound.join("; ")}.</p>
      ) : null}
    </section>
  );
}
