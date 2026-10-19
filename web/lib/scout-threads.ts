import type { ChatDocument } from "./tender-chat";

// Scout's conversations. Everything about one tender lives together: a general thread
// plus one thread per topic you asked about (a task in the bid plan). Asking about the
// same topic again resumes its thread. Threads share the tender's documents and your
// profile, but not each other's messages, so each stays focused.

export type ScoutMessage = { role: "user" | "assistant"; text: string; error?: boolean };

// What a thread is about. `context` is sent with its first question, never shown.
export type ScoutTopic = { key: string; title: string; context: string };

export type ScoutThread = {
  id: string;
  topic: ScoutTopic | null; // null: the tender in general
  messages: ScoutMessage[];
  previousId: string | null; // OpenAI response chain
  documents: ChatDocument[] | null; // PDFs Scout actually read
  updatedAt: number;
};

export type ScoutStore = { threads: ScoutThread[]; activeId: string | null };

export const MAX_THREADS = 30;

export const scoutKey = (companyId: string, tenderId: string) => `bidmagnet:scout:${companyId}:${tenderId}`;
// The single conversation per tender we kept before threads.
export const legacyChatKey = (companyId: string, tenderId: string) => `bidmagnet:chat:${companyId}:${tenderId}`;

export function emptyThread(topic: ScoutTopic | null, id: string, now: number): ScoutThread {
  return { id, topic, messages: [], previousId: null, documents: null, updatedAt: now };
}

export function readStore(raw: string | null, legacy: string | null, now: number): ScoutStore {
  try {
    if (raw) {
      const store = JSON.parse(raw) as ScoutStore;
      if (Array.isArray(store.threads)) return store;
    }
  } catch {}
  try {
    if (legacy) {
      const old = JSON.parse(legacy) as { messages?: ScoutMessage[]; previousId?: string | null; documents?: ChatDocument[] | null };
      if (old.messages?.length) {
        const thread = { ...emptyThread(null, "general-1", now), messages: old.messages, previousId: old.previousId ?? null, documents: old.documents ?? null };
        return { threads: [thread], activeId: thread.id };
      }
    }
  } catch {}
  return { threads: [], activeId: null };
}

// What gets saved: threads with messages, newest first, capped.
export function storable(store: ScoutStore): ScoutStore {
  const threads = store.threads
    .filter((thread) => thread.messages.length)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_THREADS);
  return { threads, activeId: threads.some((thread) => thread.id === store.activeId) ? store.activeId : null };
}

export function activeThread(store: ScoutStore) {
  return store.threads.find((thread) => thread.id === store.activeId) ?? null;
}

type Opened = { store: ScoutStore; thread: ScoutThread };

// Resume the latest thread on this topic (or the latest general one), or start one.
export function openThread(store: ScoutStore, topic: ScoutTopic | null, newId: () => string, now: number): Opened {
  const key = topic?.key ?? null;
  const existing = store.threads
    .filter((thread) => (thread.topic?.key ?? null) === key)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (existing) return { store: { ...store, activeId: existing.id }, thread: existing };
  const thread = emptyThread(topic, newId(), now);
  return { store: { threads: [...dropEmpty(store), thread], activeId: thread.id }, thread };
}

// "New chat": a fresh thread on the same topic as the current one.
export function startThread(store: ScoutStore, topic: ScoutTopic | null, newId: () => string, now: number): Opened {
  const thread = emptyThread(topic, newId(), now);
  return { store: { threads: [...dropEmpty(store), thread], activeId: thread.id }, thread };
}

export function updateThread(store: ScoutStore, id: string, update: (thread: ScoutThread) => ScoutThread): ScoutStore {
  return { ...store, threads: store.threads.map((thread) => (thread.id === id ? update(thread) : thread)) };
}

export function removeThread(store: ScoutStore, id: string): ScoutStore {
  const threads = store.threads.filter((thread) => thread.id !== id);
  return { threads, activeId: store.activeId === id ? null : store.activeId };
}

function dropEmpty(store: ScoutStore) {
  return store.threads.filter((thread) => thread.messages.length);
}

export function threadTitle(thread: ScoutThread) {
  if (thread.topic) return thread.topic.title;
  const first = thread.messages.find((message) => message.role === "user")?.text;
  return first ? (first.length > 48 ? `${first.slice(0, 46).trim()}…` : first) : "General chat";
}
