"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatDocument, ChatEvent } from "@/lib/tender-chat";

type Message = { role: "user" | "assistant"; text: string; error?: boolean };
type Saved = { messages: Message[]; previousId: string | null; documents: ChatDocument[] | null };

type TenderChatProps = {
  companyId: string;
  tenderId: string;
  documents: ChatDocument[];
  open: boolean;
  onClose: () => void;
};

const SUGGESTIONS = [
  "What do we have to submit, and in which envelope?",
  "Do we meet the solvency and certification requirements?",
  "How is price scored, and what discount makes sense?",
  "What could get our bid excluded?",
];

const storageKey = (companyId: string, tenderId: string) => `bidmagnet:chat:${companyId}:${tenderId}`;

function load(key: string): Saved {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {}
  return { messages: [], previousId: null, documents: null };
}

function save(key: string, value: Saved) {
  try {
    if (value.messages.length) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch {}
}

// The copilot drawer: answers from the tender's PDFs, with page citations.
export function TenderChat({ companyId, tenderId, documents, open, onClose }: TenderChatProps) {
  const key = storageKey(companyId, tenderId);
  const [state, setState] = useState<Saved>(() => load(key));
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => save(key, state), [key, state]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state.messages, status]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setDraft("");
    setBusy(true);
    setStatus(state.previousId ? "Thinking…" : "Opening the tender documents…");
    const history = state.messages.filter((message) => !message.error).map(({ role, text: body }) => ({ role, text: body }));
    setState((current) => ({ ...current, messages: [...current.messages, { role: "user", text }, { role: "assistant", text: "" }] }));

    const setAnswer = (update: (message: Message) => Message) =>
      setState((current) => {
        const messages = [...current.messages];
        messages[messages.length - 1] = update(messages[messages.length - 1]);
        return { ...current, messages };
      });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`/api/tenders/${tenderId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, previousId: state.previousId, history }),
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
          if (event.type === "status") setStatus(event.text);
          else if (event.type === "delta") {
            setStatus(null);
            setAnswer((message) => ({ ...message, text: message.text + event.text }));
          } else if (event.type === "done") {
            setState((current) => ({
              ...current,
              previousId: event.response_id,
              documents: event.documents ?? current.documents,
            }));
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
      setBusy(false);
      setStatus(null);
      abortRef.current = null;
    }
  }

  function reset() {
    abortRef.current?.abort();
    setState({ messages: [], previousId: null, documents: null });
    setBusy(false);
    setStatus(null);
    inputRef.current?.focus();
  }

  const read = state.documents ?? null;
  const sources = documents.length
    ? documents.map((doc) => (doc.kind === "pcap" ? "admin terms" : "tech specs")).join(" + ")
    : "the notice data";

  return (
    <aside className="chat" hidden={!open} aria-label="Ask AI about this tender">
      <header className="chat-head">
        <span className="chat-dot" aria-hidden="true" />
        <strong>Ask about this tender</strong>
        <span className="chat-sources">
          {read ? (read.length ? `Read ${read.map((doc) => (doc.kind === "pcap" ? "PCAP" : "PPT")).join(" + ")}` : "Couldn’t open the PDFs") : `Reads ${sources}`}
        </span>
        {state.messages.length ? (
          <button type="button" className="chat-reset" onClick={reset}>
            New chat
          </button>
        ) : null}
        <button type="button" className="chat-close" onClick={onClose} aria-label="Close chat">
          ✕
        </button>
      </header>

      <div className="chat-body" ref={listRef} aria-live="polite">
        {state.messages.length ? (
          state.messages.map((message, index) =>
            message.role === "user" ? (
              <p key={index} className="chat-q">
                {message.text}
              </p>
            ) : message.text || !busy || index !== state.messages.length - 1 ? (
              <div key={index} className={message.error ? "chat-a chat-a-error" : "chat-a"}>
                <Answer text={message.text} documents={documents} />
              </div>
            ) : null,
          )
        ) : (
          <div className="chat-empty">
            <p>
              Ask anything about this tender. Answers come from the tender’s own documents, with the page they’re on.
            </p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => ask(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {status ? (
          <p className="chat-status" role="status">
            <span className="chat-pulse" aria-hidden="true" />
            {status}
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
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          placeholder="Ask about this tender…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(draft);
            }
          }}
        />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </aside>
  );
}

function friendlyError(message: string) {
  if (/quota|credit|billing|insufficient/i.test(message)) {
    return "The AI is unavailable: the OpenAI account has run out of credits.";
  }
  return `Couldn’t answer that: ${message}`;
}

// Light formatting: paragraphs, bullets, "> " quotes, **bold**, and [PCAP p.12] links.
function Answer({ text, documents }: { text: string; documents: ChatDocument[] }) {
  const blocks: Array<{ kind: "p" | "ul" | "quote"; lines: string[] }> = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      blocks.push({ kind: "p", lines: [] });
      continue;
    }
    const kind = /^\s*[-*•]\s+/.test(line) ? "ul" : /^\s*>/.test(line) ? "quote" : "p";
    const body = line.replace(/^\s*[-*•]\s+/, "").replace(/^\s*>\s?/, "");
    const last = blocks[blocks.length - 1];
    if (last && last.kind === kind && (kind !== "p" || last.lines.length)) last.lines.push(body);
    else blocks.push({ kind, lines: [body] });
  }

  return (
    <>
      {blocks
        .filter((block) => block.lines.length)
        .map((block, index) =>
          block.kind === "ul" ? (
            <ul key={index}>
              {block.lines.map((line, item) => (
                <li key={item}>
                  <Inline text={line} documents={documents} />
                </li>
              ))}
            </ul>
          ) : block.kind === "quote" ? (
            <blockquote key={index} lang="es">
              <Inline text={block.lines.join(" ")} documents={documents} />
            </blockquote>
          ) : (
            <p key={index}>
              <Inline text={block.lines.join(" ")} documents={documents} />
            </p>
          ),
        )}
    </>
  );
}

function Inline({ text, documents }: { text: string; documents: ChatDocument[] }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\[(?:PCAP|PPT)[^\]]*\])/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
        const cite = part.match(/^\[(PCAP|PPT)\s*(?:p(?:age|\.)?\s*(\d+))?[^\]]*\]$/i);
        if (cite) {
          const doc = documents.find((item) => item.kind === cite[1].toLowerCase());
          const label = `${cite[1].toUpperCase()}${cite[2] ? ` p.${cite[2]}` : ""}`;
          return doc ? (
            <a key={index} className="chat-cite" href={`${doc.url}${cite[2] ? `#page=${cite[2]}` : ""}`} target="_blank" rel="noreferrer">
              {label}
            </a>
          ) : (
            <span key={index} className="chat-cite">
              {label}
            </span>
          );
        }
        return part;
      })}
    </>
  );
}
