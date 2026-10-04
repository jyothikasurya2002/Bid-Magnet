"use client";

import { useTenderSummary } from "./useTenderSummary";

// The AI brief of a tender, with loading and error states.
export function TenderSummaryBlock({ tenderId, compact = false }: { tenderId: string; compact?: boolean }) {
  const result = useTenderSummary(tenderId);

  return (
    <div className={`ai-summary${compact ? " ai-summary-compact" : ""}`}>
      <div className="ai-summary-head">
        <span className="ai-summary-mark" aria-hidden="true">
          ✦
        </span>
        <span>AI summary</span>
        {result && "summary" in result ? (
          <span className="ai-summary-basis">
            {result.summary.basis === "checklist" ? "from the notice and checked documents" : "from the tender notice"}
          </span>
        ) : null}
      </div>

      {!result ? (
        <div className="ai-summary-loading" role="status" aria-label="Writing the summary">
          <span />
          <span />
          <span />
        </div>
      ) : "error" in result ? (
        <p className="ai-summary-error">{result.error}</p>
      ) : (
        <>
          <p className="ai-summary-text">{result.summary.summary}</p>
          {!compact && result.summary.scope.length ? (
            <ul className="ai-summary-list">
              {result.summary.scope.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {result.summary.watch_outs.length ? (
            <ul className="ai-summary-list ai-summary-warn">
              {result.summary.watch_outs.slice(0, compact ? 2 : 3).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}
