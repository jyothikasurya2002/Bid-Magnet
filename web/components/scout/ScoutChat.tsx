"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  activeThread,
  legacyChatKey,
  openThread,
  readStore,
  removeThread,
  scoutKey,
  startThread,
  storable,
  threadTitle,
  updateThread,
  type ScoutMessage,
  type ScoutStore,
  type ScoutThread,
  type ScoutTopic,
} from "@/lib/scout-threads";
import type { ChatDocument, ChatEvent } from "@/lib/tender-chat";
import { SCOUT_SAVED } from "@/components/bid/plan-store";
import { ScoutMarkdown } from "./ScoutMarkdown";

// A topic as the page offers it: what the thread is about, plus questions to start with.
export type ScoutRequest = ScoutTopic & { suggestions?: string[] };

export type ScoutChatHandle = {
  // Open the thread for a topic (null: the general one), and optionally ask right away.
  show: (topic: ScoutRequest | null, question?: string) => void;
};

type ScoutChatProps = {
  companyId: string;
  tenderId: string;
  documents: ChatDocument[];
  open: boolean;
  onClose: () => void;
  suggestions: string[];
  ref?: React.Ref<ScoutChatHandle>;
};

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function load(companyId: string, tenderId: string): ScoutStore {
  try {
    return readStore(
      window.localStorage.getItem(scoutKey(companyId, tenderId)),
      window.localStorage.getItem(legacyChatKey(companyId, tenderId)),
      Date.now(),
    );
  } catch {
    return { threads: [], activeId: null };
  }
}

function save(companyId: string, tenderId: string, store: ScoutStore) {
  try {
    const value = storable(store);
    if (value.threads.length) window.localStorage.setItem(scoutKey(companyId, tenderId), JSON.stringify(value));
    else window.localStorage.removeItem(scoutKey(companyId, tenderId));
    window.localStorage.removeItem(legacyChatKey(companyId, tenderId));
  } catch {}
  // Lets the page mark tasks that have a chat.
  window.dispatchEvent(new Event(SCOUT_SAVED));
}

function ago(then: number, now: number) {
  const minutes = Math.round((now - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function friendlyError(message: string) {
  if (/quota|credit|billing|insufficient/i.test(message)) {
    return "Scout is unavailable: the OpenAI account has run out of credits.";
  }
  return `Couldn’t answer that: ${message}`;
}

export function ScoutChat({ companyId, tenderId, documents, open, onClose, suggestions, ref }: ScoutChatProps) {
  const [store, setStore] = useState<ScoutStore>(() => load(companyId, tenderId));
  const [topicSuggestions, setTopicSuggestions] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<{ threadId: string; status: string | null } | null>(null);
  const [picker, setPicker] = useState<number | null>(null); // open since (for "x min ago")
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const thread = activeThread(store);
  const messages = useMemo(() => thread?.messages ?? [], [thread]);
  const threadBusy = busy !== null && busy.threadId === thread?.id;

  useEffect(() => save(companyId, tenderId, store), [companyId, tenderId, store]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, store.activeId]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (picker !== null) setPicker(null);
      else onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, picker]);

  useEffect(() => {
    if (picker === null) return;
    function onPointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setPicker(null);
    }
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [picker]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useImperativeHandle(ref, () => ({
    show(topic, question) {
      const plain = topic ? { key: topic.key, title: topic.title, context: topic.context } : null;
      if (topic?.suggestions) setTopicSuggestions((current) => ({ ...current, [topic.key]: topic.suggestions! }));
      const opened = openThread(store, plain, newId, Date.now());
      setStore(opened.store);
      setPicker(null);
      if (question) void ask(question, opened.thread);
    },
  }));

  async function ask(question: string, target?: ScoutThread) {
    const text = question.trim();
    if (!text || busy) return;
    let current = target ?? thread;
    if (!current) {
      const opened = openThread(store, null, newId, Date.now());
      setStore(opened.store);
      current = opened.thread;
    }
    const id = current.id;
    const history = current.messages.filter((message) => !message.error).map(({ role, text: body }) => ({ role, text: body }));
    setDraft("");
    setBusy({ threadId: id, status: current.previousId ? "Thinking…" : "Opening the tender documents…" });
    setStore((state) =>
      updateThread(state, id, (item) => ({
        ...item,
        messages: [...item.messages, { role: "user", text }, { role: "assistant", text: "" }],
        updatedAt: Date.now(),
      })),
    );

    const setAnswer = (update: (message: ScoutMessage) => ScoutMessage) =>
      setStore((state) =>
        updateThread(state, id, (item) => {
          const list = [...item.messages];
          list[list.length - 1] = update(list[list.length - 1]);
          return { ...item, messages: list, updatedAt: Date.now() };
        }),
      );

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/tenders/${tenderId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          previousId: current.previousId,
          history,
          topic: current.topic ? { title: current.topic.title, context: current.topic.context } : null,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `The request failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ChatEvent;
          if (event.type === "status") setBusy({ threadId: id, status: event.text });
          else if (event.type === "delta") {
            setBusy({ threadId: id, status: null });
            setAnswer((message) => ({ ...message, text: message.text + event.text }));
          } else if (event.type === "done") {
            setStore((state) =>
              updateThread(state, id, (item) => ({
                ...item,
                previousId: event.response_id,
                documents: event.documents ?? item.documents,
              })),
            );
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "Something went wrong.";
      setAnswer(() => ({ role: "assistant", text: friendlyError(message), error: true }));
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  function newChat() {
    const started = startThread(store, thread?.topic ?? null, newId, Date.now());
    setStore(started.store);
    setPicker(null);
    inputRef.current?.focus();
  }

  const read = thread?.documents ?? null;
  const docLabel = documents.length
    ? documents.map((doc) => (doc.kind === "pcap" ? "PCAP" : "PPT")).join(" + ")
    : null;
  const starters = thread?.topic ? (topicSuggestions[thread.topic.key] ?? []) : suggestions;
  const sorted = [...store.threads].filter((item) => item.messages.length || item.id === store.activeId).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="chat" aria-label="Scout">
      <header className="chat-head">
        <span className="chat-dot" aria-hidden="true" />
        <strong>Scout</strong>
        <div className="chat-picker" ref={pickerRef}>
          <button
            type="button"
            className="chat-picker-button"
            aria-expanded={picker !== null}
            aria-haspopup="menu"
            onClick={() => setPicker(picker === null ? Date.now() : null)}
          >
            <span>{thread ? threadTitle(thread) : "General chat"}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {picker !== null ? (
            <div className="chat-menu" role="menu">
              <p className="chat-menu-title">Chats about this tender</p>
              {sorted.length ? (
                <ul>
                  {sorted.map((item) => (
                    <li key={item.id} className={item.id === store.activeId ? "chat-menu-active" : undefined}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setStore({ ...store, activeId: item.id });
                          setPicker(null);
                        }}
                      >
                        <span className={item.topic ? "chat-kind chat-kind-topic" : "chat-kind"}>{item.topic ? "Task" : "General"}</span>
                        <span className="chat-menu-name">{threadTitle(item)}</span>
                        <small>
                          {item.messages.length ? `${Math.ceil(item.messages.length / 2)} question${item.messages.length > 2 ? "s" : ""} · ${ago(item.updatedAt, picker)}` : "Empty"}
                        </small>
                      </button>
                      {item.messages.length ? (
                        <button
                          type="button"
                          className="chat-menu-delete"
                          aria-label={`Delete “${threadTitle(item)}”`}
                          onClick={() => setStore(removeThread(store, item.id))}
                        >
                          ✕
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="chat-menu-empty">No chats yet.</p>
              )}
              <p className="chat-menu-note">Each part of the bid you ask about keeps its own chat. Saved in this browser.</p>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="chat-icon-button"
          onClick={newChat}
          disabled={!messages.length}
          aria-label={thread?.topic ? `New chat about ${thread.topic.title}` : "New chat"}
          title={messages.length ? (thread?.topic ? `New chat about ${thread.topic.title}` : "New chat") : "You’re already in a new chat"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M7 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M11.6 2.2a1.2 1.2 0 0 1 1.7 1.7L8.2 9 6 9.6l.6-2.2 5-5.2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="chat-close" onClick={onClose} aria-label="Close Scout">
          ✕
        </button>
      </header>

      <div className="chat-body" ref={listRef} aria-live="polite">
        {messages.length ? (
          messages.map((message, index) =>
            message.role === "user" ? (
              <p key={index} className="chat-q">
                {message.text}
              </p>
            ) : message.text || !threadBusy || index !== messages.length - 1 ? (
              <div key={index} className={message.error ? "chat-a chat-a-error" : "chat-a"}>
                <ScoutMarkdown text={message.text} documents={documents} />
              </div>
            ) : null,
          )
        ) : (
          <div className="chat-empty">
            {thread?.topic ? (
              <p>
                Ask anything about <strong>{thread.topic.title}</strong>. Scout reads the tender’s documents and your profile, and
                this chat is here when you come back to the task.
              </p>
            ) : (
              <p>Ask Scout anything about this tender. Answers come from the tender’s own documents, with the page they’re on.</p>
            )}
            {starters.length ? (
              <div className="chat-suggestions">
                {starters.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => ask(suggestion)}>
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {threadBusy && busy.status ? (
          <p className="chat-status" role="status">
            <span className="chat-pulse" aria-hidden="true" />
            {busy.status}
          </p>
        ) : null}
      </div>

      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
      >
        <div className="chat-context" aria-label="What Scout sees">
          <span className="chat-context-label">Scout sees</span>
          {thread?.topic ? (
            <span className="chat-chip chat-chip-topic" title={thread.topic.context}>
              {thread.topic.title}
            </span>
          ) : null}
          <span
            className="chat-chip"
            title={read ? (read.length ? "Scout read these PDFs for this chat" : "The PDFs couldn’t be opened") : "Read when you ask the first question"}
          >
            {read ? (read.length ? `Read ${read.map((doc) => (doc.kind === "pcap" ? "PCAP" : "PPT")).join(" + ")}` : "Notice only") : docLabel ?? "Notice data"}
          </span>
          <span className="chat-chip" title="Sectors, regions, turnover, certifications, ROLECE">
            Your profile
          </span>
        </div>
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            placeholder={thread?.topic ? `Ask about ${thread.topic.title}…` : "Ask Scout about this tender…"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void ask(draft);
              }
            }}
          />
          <button type="submit" disabled={busy !== null || !draft.trim()} aria-label="Send">
            ↑
          </button>
        </div>
      </form>
    </aside>
  );
}
