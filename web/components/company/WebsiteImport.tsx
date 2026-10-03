"use client";

import { useEffect, useRef, useState } from "react";
import type { ImportResult, ImportSuggestion, ResearchPoll } from "@/lib/types";

const FIELD_LABELS: Record<ImportSuggestion["field"], string> = {
  name: "Legal name",
  nif: "NIF",
  description: "What you do",
  website_url: "Website",
  keywords: "Keywords",
  cpv_prefixes: "Sector codes",
  regions: "Regions",
  certifications: "Certifications mentioned",
};

const POLL_MS = 4_000;
const GIVE_UP_MS = 12 * 60_000;

type WebsiteImportProps = {
  url: string;
  companyId: string;
  onApply: (suggestion: ImportSuggestion) => Promise<boolean>;
  onClose: () => void;
};

// Reads JSON, or turns an HTML error page (timeouts, crashes) into a readable message.
async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`The server answered with an error (${response.status}). Try again.`);
  }
  if (!response.ok) {
    throw new Error((body as { error?: string }).error || `Request failed (${response.status}).`);
  }
  return body as T;
}

// The job id survives a reload, so research that takes minutes isn't lost.
const storageKey = (companyId: string) => `bidmagnet:research:${companyId}`;
function savedJob(companyId: string, url: string) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(companyId)) || "null");
    return saved?.url === url ? (saved as { id: string; url: string; startedAt: number }) : null;
  } catch {
    return null;
  }
}
function saveJob(companyId: string, job: { id: string; url: string; startedAt: number } | null) {
  try {
    if (job) sessionStorage.setItem(storageKey(companyId), JSON.stringify(job));
    else sessionStorage.removeItem(storageKey(companyId));
  } catch {
    // Storage unavailable: the research still works, it just won't survive a reload.
  }
}

// One start request per attempt, even when React runs the effect twice in development.
const starting = new Map<string, Promise<{ id: string }>>();

function elapsedLabel(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function WebsiteImport({ url, companyId, onApply, onClose }: WebsiteImportProps) {
  const [state, setState] = useState<"running" | "ready" | "error">("running");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<Record<number, "used" | "skipped">>({});
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const jobId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function poll(id: string, started: number) {
      if (cancelled) return;
      try {
        const answer = await readJson<ResearchPoll>(await fetch(`/api/company/research/${id}`));
        if (cancelled) return;
        if (answer.status === "running") {
          if (Date.now() - started > GIVE_UP_MS) throw new Error("The research is taking too long. Try again.");
          timer = window.setTimeout(() => void poll(id, started), POLL_MS);
          return;
        }
        saveJob(companyId, null);
        jobId.current = null;
        if (answer.status === "failed") throw new Error(answer.error);
        setResult(answer.result);
        setState("ready");
      } catch (caught) {
        if (cancelled) return;
        saveJob(companyId, null);
        jobId.current = null;
        setError(caught instanceof Error ? caught.message : "The research failed. Try again.");
        setState("error");
      }
    }

    async function start() {
      const resumed = savedJob(companyId, url);
      if (resumed) {
        jobId.current = resumed.id;
        setStartedAt(resumed.startedAt);
        return poll(resumed.id, resumed.startedAt);
      }
      try {
        const key = `${companyId}|${url}|${attempt}`;
        if (!starting.has(key)) {
          starting.set(
            key,
            fetch("/api/company/research", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url, companyId }),
            }).then((response) => readJson<{ id: string }>(response)),
          );
        }
        const { id } = await starting.get(key)!.finally(() => starting.delete(key));
        const started = Date.now();
        jobId.current = id;
        saveJob(companyId, { id, url, startedAt: started });
        if (cancelled) return;
        setStartedAt(started);
        timer = window.setTimeout(() => void poll(id, started), POLL_MS);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "The research couldn't start.");
        setState("error");
      }
    }

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [url, companyId, attempt]);

  useEffect(() => {
    if (state !== "running") return;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, [state]);

  function close() {
    const id = jobId.current;
    if (id) {
      saveJob(companyId, null);
      void fetch(`/api/company/research/${id}`, { method: "DELETE" });
    }
    onClose();
  }

  function retry() {
    setError("");
    setResult(null);
    setDone({});
    setState("running");
    setNow(Date.now());
    setAttempt((value) => value + 1);
  }

  const host = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const remaining = result?.suggestions.filter((_, index) => !done[index]).length ?? 0;
  const cited = result?.sources.filter((source) => source.cited).length ?? 0;

  return (
    <div className="import-box" role="region" aria-label="Suggestions from researching your company">
      <div className="import-box-head">
        <strong>Researching {host}</strong>
        <span>
          {state === "running"
            ? `Searching your site and public sources · ${elapsedLabel(Math.max(0, now - startedAt))} · usually 1–4 minutes`
            : state === "ready"
              ? remaining
                ? `${remaining} suggestion${remaining === 1 ? "" : "s"} to review. Nothing changes until you use one.`
                : result?.suggestions.length
                  ? "All suggestions reviewed."
                  : "Nothing we could back with a quote."
              : null}
        </span>
        <button type="button" className="link-button" onClick={close}>
          {state === "running" ? "Cancel" : "Close"}
        </button>
      </div>

      {state === "running" ? (
        <p className="import-box-note" role="status">
          <span className="spinner" aria-hidden="true" /> You can keep editing. Each suggestion
          will quote the page it came from, and we check the quote is really there.
        </p>
      ) : null}

      {state === "error" ? (
        <p className="import-box-note" role="alert">
          <span className="doc-text-error">{error}</span>
          <button type="button" className="link-button link-strong" onClick={retry}>
            Try again
          </button>
        </p>
      ) : null}

      {result?.ambiguous ? (
        <p className="import-box-note">
          Other companies share this name, so we only used your own website.
        </p>
      ) : null}

      {result?.suggestions.map((suggestion, index) => {
        const status = done[index];
        const value = suggestion.values.length ? suggestion.values.join(", ") : suggestion.value_text;
        return (
          <div className={`suggestion${status ? " suggestion-done" : ""}`} key={index}>
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
              {status ? (
                <span className="fact-empty">{status === "used" ? "Added" : "Skipped"}</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="link-button link-strong"
                    onClick={async () => {
                      if (await onApply(suggestion)) setDone((current) => ({ ...current, [index]: "used" }));
                    }}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setDone((current) => ({ ...current, [index]: "skipped" }))}
                  >
                    Skip
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}

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
