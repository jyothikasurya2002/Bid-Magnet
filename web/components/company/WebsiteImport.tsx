"use client";

import { useState } from "react";
import type { ImportSuggestion } from "@/lib/types";
import { SuggestionRow } from "./SuggestionRow";
import { elapsedLabel, useNow, useResearchJob } from "./useResearchJob";

type WebsiteImportProps = {
  url: string;
  companyId: string;
  onApply: (suggestion: ImportSuggestion) => Promise<boolean>;
  onClose: () => void;
};

// Re-running research from the company page; suggestions wait for Use / Skip.
export function WebsiteImport({ url, companyId, onApply, onClose }: WebsiteImportProps) {
  const job = useResearchJob(companyId, url);
  const [done, setDone] = useState<Record<number, "used" | "skipped">>({});
  const { state } = job;
  const now = useNow(state.kind === "running");
  const result = state.kind === "done" ? state.result : null;

  const host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const remaining = result?.suggestions.filter((_, index) => !done[index]).length ?? 0;
  const cited = result?.sources.filter((source) => source.cited).length ?? 0;

  return (
    <div className="import-box" role="region" aria-label="Suggestions from researching your company">
      <div className="import-box-head">
        <strong>Researching {host}</strong>
        <span>
          {state.kind === "running"
            ? `Searching your site and public sources · ${elapsedLabel(now - state.startedAt)} · usually 1–4 minutes`
            : result
              ? remaining
                ? `${remaining} suggestion${remaining === 1 ? "" : "s"} to review. Nothing changes until you use one.`
                : result.suggestions.length
                  ? "All suggestions reviewed."
                  : "Nothing we could back with a quote."
              : null}
        </span>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            job.cancel();
            onClose();
          }}
        >
          {state.kind === "running" ? "Cancel" : "Close"}
        </button>
      </div>

      {state.kind === "running" ? (
        <p className="import-box-note" role="status">
          <span className="spinner" aria-hidden="true" /> You can keep editing. Each suggestion
          will quote the page it came from, and we check the quote is really there.
        </p>
      ) : null}

      {state.kind === "error" ? (
        <p className="import-box-note" role="alert">
          <span className="doc-text-error">{state.message}</span>
          <button
            type="button"
            className="link-button link-strong"
            onClick={() => {
              setDone({});
              job.retry();
            }}
          >
            Try again
          </button>
        </p>
      ) : null}

      {result?.ambiguous ? (
        <p className="import-box-note">
          Other companies share this name, so we only used your own website.
        </p>
      ) : null}

      {result?.suggestions.map((suggestion, index) => (
        <SuggestionRow
          key={index}
          suggestion={suggestion}
          status={done[index]}
          onUse={async () => {
            if (await onApply(suggestion)) setDone((current) => ({ ...current, [index]: "used" }));
          }}
          onSkip={() => setDone((current) => ({ ...current, [index]: "skipped" }))}
        />
      ))}

      {result ? (
        <details className="import-box-sources">
          <summary>
            {result.sources.length} sources checked{cited ? `, ${cited} quoted` : ""}
            {result.not_found.length ? ` · ${result.not_found.length} things not found` : ""}
          </summary>
          <ul>
            {result.sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
                {source.cited ? " · quoted" : ""}
              </li>
            ))}
          </ul>
          {result.not_found.length ? <p>Not found: {result.not_found.join("; ")}</p> : null}
        </details>
      ) : null}
    </div>
  );
}
