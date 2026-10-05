"use client";

import { useState } from "react";
import { useTenderSummary } from "./useTenderSummary";

// The AI brief of a tender, with loading and error states. With auto off, it waits
// for a click, so no AI call is made for tenders nobody opened.
export function TenderSummaryBlock({
  tenderId,
  compact = false,
  auto = true,
}: {
  tenderId: string;
  compact?: boolean;
  auto?: boolean;
}) {
  const [requested, setRequested] = useState(false);
  const enabled = auto || requested;
  const result = useTenderSummary(enabled ? tenderId : null);

  if (!enabled) {
    return (
      <button type="button" className={`ai-summary ai-summary-start${compact ? " ai-summary-compact" : ""}`} onClick={() => setRequested(true)}>
        <span className="ai-summary-mark" aria-hidden="true">
          ✦
        </span>
        <span>Summarise this tender with AI</span>
      </button>
    );
  }

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
