"use client";

import { useEffect, useState } from "react";
import type { AwardHistory } from "@/lib/award-history";
import type { ImportSuggestion } from "@/lib/types";
import { SuggestionRow } from "./SuggestionRow";

type AwardImportProps = {
  nif: string;
  onApply: (suggestion: ImportSuggestion) => Promise<boolean> | boolean;
  onClose: () => void;
};

const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", notation: "compact", maximumFractionDigits: 1 });

type State = { kind: "loading" } | { kind: "error" } | { kind: "done"; history: AwardHistory; suggestions: ImportSuggestion[] };

// Profile facts from the contracts this NIF has won (no AI, our own award records).
export function AwardImport({ nif, onApply, onClose }: AwardImportProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [done, setDone] = useState<Record<number, "used" | "skipped">>({});

  useEffect(() => {
    let active = true;
    void fetch(`/api/company/award-history?nif=${encodeURIComponent(nif)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { history: AwardHistory; suggestions: ImportSuggestion[] }) => {
        if (active) setState({ kind: "done", ...body });
      })
      .catch(() => {
        if (active) setState({ kind: "error" });
      });
    return () => {
      active = false;
    };
  }, [nif]);

  const history = state.kind === "done" ? state.history : null;

  return (
    <div className="import-box" role="region" aria-label="Suggestions from your past awards">
      <div className="import-box-head">
        <strong>Your past awards</strong>
        <span>
          {state.kind === "loading"
            ? "Looking up contracts won under this NIF…"
            : state.kind === "error"
              ? "Couldn't load your award history."
              : history?.tenders
                ? `${history.tenders} contract${history.tenders === 1 ? "" : "s"} won · ${EURO.format(history.total)} · from ${history.buyers.length} buyer${history.buyers.length === 1 ? "" : "s"} (Jan–Sep 2026)`
                : "No contracts won under this NIF in our records (Jan–Sep 2026). Joint ventures (UTEs) have their own NIF."}
        </span>
        <button type="button" className="link-button" onClick={onClose}>
          Close
        </button>
      </div>

      {state.kind === "done" && history?.tenders && !state.suggestions.length ? (
        <p className="import-box-note">Your profile already covers what your awards show.</p>
      ) : null}

      {state.kind === "done"
        ? state.suggestions.map((suggestion, index) => (
            <SuggestionRow
              key={index}
              suggestion={suggestion}
              status={done[index]}
              onUse={async () => {
                if (await onApply(suggestion)) setDone((current) => ({ ...current, [index]: "used" }));
              }}
              onSkip={() => setDone((current) => ({ ...current, [index]: "skipped" }))}
            />
          ))
        : null}
    </div>
  );
}
