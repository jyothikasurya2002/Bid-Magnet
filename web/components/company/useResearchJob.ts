"use client";

import { useEffect, useRef, useState } from "react";
import type { ImportResult, ResearchPoll } from "@/lib/types";

const POLL_MS = 4_000;
const GIVE_UP_MS = 12 * 60_000;

// Reads JSON, or turns an HTML error page (timeouts, crashes) into a readable message.
export async function readJson<T>(response: Response): Promise<T> {
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

type SavedJob = { id: string; url: string; startedAt: number };

// The job id survives a reload, so research that takes minutes isn't lost.
const storageKey = (companyId: string) => `bidmagnet:research:${companyId}`;
export function savedResearchJob(companyId: string): SavedJob | null {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(companyId)) || "null");
  } catch {
    return null;
  }
}
function saveJob(companyId: string, job: SavedJob | null) {
  try {
    if (job) sessionStorage.setItem(storageKey(companyId), JSON.stringify(job));
    else sessionStorage.removeItem(storageKey(companyId));
  } catch {
    // Storage unavailable: the research still works, it just won't survive a reload.
  }
}

// One start request per attempt, even when React runs the effect twice in development.
const starting = new Map<string, Promise<{ id: string }>>();

export function elapsedLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export type ResearchState =
  | { kind: "idle" }
  | { kind: "running"; startedAt: number }
  | { kind: "done"; result: ImportResult }
  | { kind: "error"; message: string };

// Starts (or resumes) background research for a company website and polls until it ends.
// `enabled: false` keeps it idle; `onDone` runs once with the result.
export function useResearchJob(
  companyId: string,
  url: string,
  options: { enabled?: boolean; onDone?: (result: ImportResult) => void } = {},
) {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<ResearchState>(() =>
    enabled ? { kind: "running", startedAt: Date.now() } : { kind: "idle" },
  );
  const [attempt, setAttempt] = useState(0);
  const jobId = useRef<string | null>(null);
  const onDone = useRef(options.onDone);
  useEffect(() => {
    onDone.current = options.onDone;
  });

  useEffect(() => {
    if (!enabled || !companyId || !url) return;
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
        setState({ kind: "done", result: answer.result });
        onDone.current?.(answer.result);
      } catch (caught) {
        if (cancelled) return;
        saveJob(companyId, null);
        jobId.current = null;
        setState({
          kind: "error",
          message: caught instanceof Error ? caught.message : "The research failed. Try again.",
        });
      }
    }

    async function start() {
      const resumed = savedResearchJob(companyId);
      if (resumed?.url === url) {
        jobId.current = resumed.id;
        setState({ kind: "running", startedAt: resumed.startedAt });
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
        setState({ kind: "running", startedAt: started });
        timer = window.setTimeout(() => void poll(id, started), POLL_MS);
      } catch (caught) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: caught instanceof Error ? caught.message : "The research couldn't start.",
        });
      }
    }

    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [url, companyId, attempt, enabled]);

  return {
    state,
    retry() {
      setState({ kind: "running", startedAt: Date.now() });
      setAttempt((value) => value + 1);
    },
    // Stops the job at OpenAI; used when the user closes or skips.
    cancel() {
      const id = jobId.current;
      if (!id) return;
      jobId.current = null;
      saveJob(companyId, null);
      void fetch(`/api/company/research/${id}`, { method: "DELETE" });
    },
  };
}

// Ticks once a second while `active`, for elapsed-time labels.
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(tick);
  }, [active]);
  return now;
}
