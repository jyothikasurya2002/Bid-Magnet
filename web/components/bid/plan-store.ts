"use client";

import { useMemo, useSyncExternalStore } from "react";
import { planStorageKey, type PlanState, type TaskState } from "@/lib/bid-plan";

// Bid plan progress (status, who, dates, notes), kept in this browser and shared live
// between the plan page, the to-do list and Scout's chat markers.

export const SCOUT_SAVED = "bidmagnet:scout-saved";

const listeners = new Set<() => void>();

export function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  window.addEventListener(SCOUT_SAVED, listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
    window.removeEventListener(SCOUT_SAVED, listener);
  };
}

export function readRaw(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "{}";
  } catch {
    return "{}";
  }
}

function parse(raw: string): PlanState {
  try {
    return JSON.parse(raw) as PlanState;
  } catch {
    return {};
  }
}

export function writeTask(key: string, id: string, patch: TaskState) {
  const state = parse(readRaw(key));
  const next = { ...state, [id]: { ...state[id], ...patch } };
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {}
  listeners.forEach((listener) => listener());
}

export function usePlanState(companyId: string, tenderId: string) {
  const key = planStorageKey(companyId, tenderId);
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => "{}");
  const state = useMemo(() => parse(raw), [raw]);
  return [state, (id: string, patch: TaskState) => writeTask(key, id, patch)] as const;
}

// Several tenders' progress at once (the to-do list on Bid prep).
export function usePlanStates(companyId: string, tenderIds: string[]) {
  const keys = tenderIds.map((id) => planStorageKey(companyId, id));
  const raw = useSyncExternalStore(subscribe, () => keys.map(readRaw).join("\u0000"), () => "");
  return useMemo(() => {
    const parts = raw ? raw.split("\u0000") : [];
    return Object.fromEntries(tenderIds.map((id, index) => [id, parse(parts[index] ?? "{}")]));
    // tenderIds is derived from props; raw changes whenever any of them does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);
}
