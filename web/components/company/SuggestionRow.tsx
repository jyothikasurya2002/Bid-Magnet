"use client";

import type { ImportSuggestion } from "@/lib/types";

export const FIELD_LABELS: Record<ImportSuggestion["field"], string> = {
  name: "Legal name",
  nif: "NIF",
  description: "What you do",
  website_url: "Website",
  keywords: "Keywords",
  cpv_prefixes: "Sector codes",
  regions: "Regions",
  certifications: "Certifications mentioned",
};

type SuggestionRowProps = {
  suggestion: ImportSuggestion;
  // "used" / "skipped" once decided; "added" for facts filled in automatically
  status?: "used" | "skipped" | "added";
  onUse?: () => void;
  onSkip?: () => void;
};

// One researched fact with the page and quote it came from.
export function SuggestionRow({ suggestion, status, onUse, onSkip }: SuggestionRowProps) {
  const value = suggestion.values.length ? suggestion.values.join(", ") : suggestion.value_text;
  return (
    <div className={`suggestion${status === "used" || status === "skipped" ? " suggestion-done" : ""}`}>
      <span className="suggestion-field">{FIELD_LABELS[suggestion.field]}</span>
      <div className="suggestion-body">
        <span className="suggestion-value">{value}</span>
        {suggestion.explanation ? <small>{suggestion.explanation}</small> : null}
        <small>
          {suggestion.verified ? "Quoted from " : "Couldn't re-check "}
          <a href={suggestion.source_url} target="_blank" rel="noreferrer">
            {suggestion.source_title || suggestion.source_url.replace(/^https?:\/\//, "")}
          </a>
          : “{suggestion.source_quote}”
        </small>
      </div>
      <div className="suggestion-actions">
        {status === "added" ? (
          <span className="pill pill-good">Added</span>
        ) : status ? (
          <span className="fact-empty">{status === "used" ? "Added" : "Skipped"}</span>
        ) : (
          <>
            <button type="button" className="link-button link-strong" onClick={onUse}>
              Use
            </button>
            <button type="button" className="link-button" onClick={onSkip}>
              Skip
            </button>
          </>
        )}
      </div>
    </div>
  );
}
