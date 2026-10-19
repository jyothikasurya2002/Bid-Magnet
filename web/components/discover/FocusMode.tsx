"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  businessDaysUntil,
  reasonLabel,
  durationLabel,
  PASS_REASONS,
  sourceLabel,
  TRIAGE_BATCH,
  type Decision,
  type FeedTender,
} from "@/lib/discover";
import { RiskNote } from "./RiskNote";
import { useTenderSummary } from "./useTenderSummary";
import { dateFormat } from "@/lib/dates";

type FocusModeProps = {
  queue: FeedTender[]; // the filtered, sorted list from Discover
  // Changes when filters or sort change; the remaining cards are rebuilt from `queue`.
  queueKey: string;
  filterBar: React.ReactNode;
  filterSummary: string[];
  onDecide: (id: string, decision: Decision | null, reason?: string) => void;
  onExit: () => void;
  onShowInterested: () => void;
};

type Choice = "go" | "watch" | "no_go";
type Exit = {
  key: string;
  tender: FeedTender;
  from: string;
  to: string;
  ms: number;
};

const LABEL: Record<Choice, string> = {
  go: "Interested",
  watch: "Later",
  no_go: "Not for us",
};
const EURO = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const DATE = dateFormat({ weekday: true });

const DEAD_ZONE = 8; // px before a press becomes a drag
const COMMIT_SHARE = 0.3; // of card width
const FLICK_SPEED = 0.5; // px per ms

// One tender at a time: decide with a swipe, the buttons or the keyboard.
export function FocusMode({
  queue: initialQueue,
  queueKey,
  filterBar,
  filterSummary,
  onDecide,
  onExit,
  onShowInterested,
}: FocusModeProps) {
  const [queue, setQueue] = useState(initialQueue);
  const [index, setIndex] = useState(0);
  const [batchStart, setBatchStart] = useState(0);
  const [batchEnd, setBatchEnd] = useState(
    Math.min(TRIAGE_BATCH, initialQueue.length),
  );
  const [history, setHistory] = useState<
    Array<{ tender: FeedTender; choice: Choice }>
  >([]);
  const [exits, setExits] = useState<Exit[]>([]);
  const [drag, setDrag] = useState({ x: 0, y: 0, active: false, width: 560 });
  const [returning, setReturning] = useState<Choice | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [given, setGiven] = useState<Record<string, string>>({});
  const [seenKey, setSeenKey] = useState(queueKey);
  // New filters or sort: start over on the remaining tenders, keep what was decided.
  if (queueKey !== seenKey) {
    setSeenKey(queueKey);
    setQueue(initialQueue);
    setIndex(0);
    setBatchStart(0);
    setBatchEnd(Math.min(TRIAGE_BATCH, initialQueue.length));
    setReasonFor(null);
    setReturning(null);
  }
  const cardRef = useRef<HTMLElement>(null);
  const press = useRef<{
    x: number;
    y: number;
    dragging: boolean;
    samples: Array<{ x: number; t: number }>;
  } | null>(null);

  const current = index < batchEnd ? queue[index] : undefined;

  const commit = useCallback(
    (choice: Choice, gesture?: { x: number; y: number; speed: number }) => {
      if (!current) return;
      const width = window.innerWidth;
      const from = gesture
        ? `translate(${gesture.x}px, ${gesture.y}px) rotate(${rotation(gesture.x)}deg)`
        : "translate(0, 0) rotate(0deg)";
      const to =
        choice === "watch"
          ? "translate(0, 70vh) rotate(0deg)"
          : `translate(${choice === "go" ? width : -width}px, ${(gesture?.y ?? 0) + 60}px) rotate(${choice === "go" ? 16 : -16}deg)`;
      // A flick keeps its speed; a button press uses a short, even exit.
      const ms = gesture
        ? Math.round(
            Math.min(
              300,
              Math.max(180, width / 2 / Math.max(gesture.speed, 0.01)),
            ),
          )
        : 240;
      const key = `${current.tender_id}-${Date.now()}`;
      setExits((items) => [...items, { key, tender: current, from, to, ms }]);
      window.setTimeout(
        () => setExits((items) => items.filter((item) => item.key !== key)),
        ms + 40,
      );

      onDecide(current.tender_id, choice);
      setHistory((items) => [...items, { tender: current, choice }]);
      setIndex((value) => value + 1);
      setDrag((current) => ({ ...current, x: 0, y: 0, active: false }));
      setReturning(null);
      setReasonFor(choice === "no_go" ? current.tender_id : null);
      const left = batchEnd - index - 1;
      setAnnounce(`${LABEL[choice]}. ${left} left.`);
    },
    [current, onDecide, batchEnd, index],
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    onDecide(last.tender.tender_id, null);
    setHistory((items) => items.slice(0, -1));
    if (queue[index - 1]?.tender_id === last.tender.tender_id) {
      setIndex((value) => Math.max(0, value - 1));
    } else {
      // Decided before the filters changed: put it back in front.
      setQueue((items) => [
        ...items.slice(0, index),
        last.tender,
        ...items.slice(index),
      ]);
      setBatchEnd((value) => value + 1);
    }
    setReturning(last.choice);
    setReasonFor(null);
    setAnnounce(`Undone. Back to ${last.tender.title}.`);
  }, [history, onDecide, queue, index]);

  const giveReason = useCallback(
    (key: string) => {
      if (!reasonFor) return;
      onDecide(reasonFor, "no_go", key);
      setGiven((items) => ({ ...items, [reasonFor]: key }));
      setReasonFor(null);
      setAnnounce("Reason saved.");
    },
    [reasonFor, onDecide],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Typing in the filters (search, budget) shouldn't swipe cards.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select")) {
        if (event.key === "Escape") target.blur();
        return;
      }
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFiltersOpen((open) => !open);
        return;
      }
      const key = event.key.toLowerCase();
      if (reasonFor && /^[1-5]$/.test(key)) {
        giveReason(PASS_REASONS[Number(key) - 1].key);
      } else if (key === "arrowright" || key === "i") {
        event.preventDefault();
        commit("go");
      } else if (key === "arrowleft" || key === "x") {
        event.preventDefault();
        commit("no_go");
      } else if (key === "arrowdown" || key === "l") {
        event.preventDefault();
        commit("watch");
      } else if (key === "z") {
        undo();
      } else if (key === "o" && current?.link) {
        window.open(current.link, "_blank", "noopener");
      } else if (key === "escape") {
        onExit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, undo, giveReason, reasonFor, current, onExit]);

  function onPointerDown(event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest("a,button")) return;
    press.current = {
      x: event.clientX,
      y: event.clientY,
      dragging: false,
      samples: [{ x: event.clientX, t: event.timeStamp }],
    };
  }

  function onPointerMove(event: React.PointerEvent) {
    const state = press.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.dragging) {
      if (Math.abs(dx) < DEAD_ZONE && Math.abs(dy) < DEAD_ZONE) return;
      // Mostly vertical: let the page scroll instead.
      if (Math.abs(dy) > Math.abs(dx)) {
        press.current = null;
        return;
      }
      state.dragging = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    state.samples = [
      ...state.samples.filter((sample) => event.timeStamp - sample.t < 80),
      { x: event.clientX, t: event.timeStamp },
    ];
    setDrag({
      x: dx,
      y: dy * 0.3,
      active: true,
      width: cardRef.current?.offsetWidth ?? 560,
    });
  }

  function onPointerUp(event: React.PointerEvent) {
    const state = press.current;
    press.current = null;
    if (!state) return;
    if (!state.dragging) return;
    const first = state.samples[0];
    const elapsed = Math.max(1, event.timeStamp - first.t);
    const speed = Math.abs(event.clientX - first.x) / elapsed;
    const width = drag.width;
    const x = drag.x;
    if (
      Math.abs(x) >= width * COMMIT_SHARE ||
      (speed >= FLICK_SPEED && Math.abs(x) >= 40)
    ) {
      commit(x > 0 ? "go" : "no_go", { x, y: drag.y, speed });
    } else {
      setDrag((current) => ({ ...current, x: 0, y: 0, active: false }));
    }
  }

  const leaning = drag.x > 0 ? "go" : drag.x < 0 ? "no_go" : null;
  const strength = Math.min(1, Math.abs(drag.x) / (drag.width * COMMIT_SHARE));
  const tally = {
    go: history.filter((item) => item.choice === "go").length,
    watch: history.filter((item) => item.choice === "watch").length,
    no_go: history.filter((item) => item.choice === "no_go").length,
  };
  const last = history[history.length - 1];
  const remainingAfterBatch = queue.length - batchEnd;
  const batchSize = Math.max(1, batchEnd - batchStart);
  const done = index - batchStart;

  return (
    <section className="tri" aria-label="Triage">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <aside className="tri-rail">
        <header className="tri-head">
          <div className="tri-head-left">
            <strong>Triage</strong>
            <span className="mono">
              {current ? `${done + 1} of ${batchSize}` : "Done"}
            </span>
          </div>
          <button type="button" className="tri-exit-button" onClick={onExit}>
            Back to list <kbd>Esc</kbd>
          </button>
          <div className="tri-progress" aria-hidden="true">
            <span
              style={{
                width: `${(Math.min(done, batchSize) / batchSize) * 100}%`,
              }}
            />
          </div>
          <div className="tri-tally">
            <span>
              <b className="mono">{tally.go}</b> interested
            </span>
            <span>
              <b className="mono">{tally.watch}</b> later
            </span>
            <span>
              <b className="mono">{tally.no_go}</b> not for us
            </span>
          </div>
        </header>

        <div
          className={
            filtersOpen ? "tri-filters tri-filters-open" : "tri-filters"
          }
        >
          <button
            type="button"
            className="tri-filter-toggle"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M2 4h12M4.5 8h7M7 12h2"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <span className="tri-filter-label">Filters</span>
            <span className="tri-filter-summary">
              {filterSummary.length ? (
                filterSummary.map((item) => <span key={item}>{item}</span>)
              ) : (
                <em>None · all your matches</em>
              )}
            </span>
            <span className="tri-filter-count">
              {Math.max(0, queue.length - index)} to go
            </span>
            <kbd>F</kbd>
            <svg
              className="tri-filter-chevron"
              width="10"
              height="10"
              viewBox="0 0 10 10"
              aria-hidden="true"
            >
              <path
                d="M2 3.5l3 3 3-3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="tri-filter-head">
            <strong>Filters</strong>
            <span className="mono">
              {Math.max(0, queue.length - index)} to go
            </span>
          </div>
          <div className="tri-filter-panel">{filterBar}</div>
        </div>
      </aside>

      <div className="tri-main">
        <div className="tri-stage">
          {exits.map((item) => (
            <div
              key={item.key}
              className="tri-card-wrap tri-leaving"
              style={
                {
                  "--from": item.from,
                  "--to": item.to,
                  animationDuration: `${item.ms}ms`,
                } as React.CSSProperties
              }
              aria-hidden="true"
            >
              <TriageCard tender={item.tender} />
            </div>
          ))}

          {current ? (
            <div
              key={current.tender_id}
              className={`tri-card-wrap${returning ? ` tri-return-${returning}` : " tri-enter"}${drag.active ? " tri-dragging" : ""}`}
              style={{
                transform:
                  drag.active || drag.x
                    ? `translate(${drag.x}px, ${drag.y}px) rotate(${rotation(drag.x)}deg)`
                    : undefined,
                boxShadow:
                  leaning && strength > 0.05
                    ? `0 0 0 ${1 + strength}px ${leaning === "go" ? "var(--accent)" : "var(--text-body)"}, 0 24px 48px -12px rgb(36 33 30 / 26%)`
                    : undefined,
              }}
            >
              <article
                ref={cardRef}
                className="tri-card"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                  press.current = null;
                  setDrag((current) => ({
                    ...current,
                    x: 0,
                    y: 0,
                    active: false,
                  }));
                }}
              >
                {leaning && strength > 0.15 ? (
                  <span
                    className={`tri-lean tri-lean-${leaning}`}
                    style={{
                      opacity: Math.min(1, strength * 1.2),
                      transform: `scale(${0.9 + strength * 0.1})`,
                    }}
                  >
                    {leaning === "go" ? "✓ Interested" : "✕ Not for us"}
                  </span>
                ) : null}
                <TriageCard tender={current} />
              </article>
            </div>
          ) : !queue.length ? (
            <div className="tri-empty">
              <strong>No tenders left with these filters</strong>
              <p>Loosen a filter to keep going, or go back to the list.</p>
              <button
                type="button"
                className="tri-btn"
                onClick={() => setFiltersOpen(true)}
              >
                Change filters
              </button>
            </div>
          ) : (
            <TriageSummary
              history={history}
              remaining={remainingAfterBatch}
              onUndoOne={(id) => {
                onDecide(id, null);
                setHistory((items) =>
                  items.filter((item) => item.tender.tender_id !== id),
                );
              }}
              onKeepGoing={() => {
                setBatchStart(batchEnd);
                setBatchEnd(Math.min(queue.length, batchEnd + TRIAGE_BATCH));
              }}
              onDecideLater={(tenders) => {
                setQueue(tenders);
                setIndex(0);
                setBatchStart(0);
                setBatchEnd(tenders.length);
                setHistory([]);
              }}
              onShowInterested={onShowInterested}
              onExit={onExit}
            />
          )}
        </div>

        {current ? (
          <div className="tri-dock">
            <div className="tri-actions">
              <button
                type="button"
                className="tri-btn tri-btn-no"
                onClick={() => commit("no_go")}
              >
                <span aria-hidden="true">✕</span> Not for us <kbd>←</kbd>
              </button>
              <button
                type="button"
                className="tri-btn tri-btn-later"
                onClick={() => commit("watch")}
              >
                Later <kbd>↓</kbd>
              </button>
              <button
                type="button"
                className="tri-btn tri-btn-yes"
                onClick={() => commit("go")}
              >
                <span aria-hidden="true">✓</span> Interested <kbd>→</kbd>
              </button>
            </div>

            {last ? (
              <div className="tri-receipt" role="status">
                <div className="tri-receipt-head">
                  <span className="tri-receipt-kicker">Previous tender</span>
                  <span
                    className={`tri-receipt-tag tri-receipt-${last.choice}`}
                  >
                    {LABEL[last.choice]}
                  </span>
                  <span
                    className="tri-receipt-title"
                    lang="es"
                    title={last.tender.title}
                  >
                    {last.tender.title}
                  </span>
                  <button type="button" className="tri-undo" onClick={undo}>
                    ↶ Undo <kbd>Z</kbd>
                  </button>
                </div>
                {reasonFor === last.tender.tender_id ? (
                  <div className="tri-receipt-ask">
                    <span>
                      Why wasn’t it for you?{" "}
                      <small>Optional · helps rank future tenders</small>
                    </span>
                    <div className="tri-reasons-pick">
                      {PASS_REASONS.map((reason, position) => (
                        <button
                          key={reason.key}
                          type="button"
                          className="tri-reason-chip"
                          onClick={() => giveReason(reason.key)}
                        >
                          {reason.label} <kbd>{position + 1}</kbd>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : given[last.tender.tender_id] ? (
                  <p className="tri-receipt-saved">
                    Reason saved:{" "}
                    {
                      PASS_REASONS.find(
                        (reason) => reason.key === given[last.tender.tender_id],
                      )?.label
                    }
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function rotation(x: number) {
  return Math.max(-12, Math.min(12, x * 0.05));
}

function TriageCard({ tender }: { tender: FeedTender }) {
  const result = useTenderSummary(tender.tender_id);
  const summary = result && "summary" in result ? result.summary : null;
  const days = tender.deadline_date
    ? businessDaysUntil(tender.deadline_date)
    : null;
  const stoppers = tender.reasons.filter((reason) => reason.type === "gap");
  const pros = tender.reasons.filter(
    (reason) => reason.type === "ok" && reason.points > 0,
  );
  const cautions = tender.reasons.filter((reason) => reason.type === "warn");
  const duration = durationLabel(tender.duration, tender.duration_unit);

  return (
    <>
      <div className="tri-top">
        {tender.score !== null ? (
          <span className="tri-fit">
            <b className="mono">{tender.score}</b>
            <span>fit</span>
          </span>
        ) : null}
        <span className="tri-money mono">
          {tender.budget_no_tax !== null
            ? EURO.format(tender.budget_no_tax)
            : "Budget not given"}
        </span>
        {days !== null ? (
          <span className={days <= 5 ? "tri-days tri-days-urgent" : "tri-days"}>
            {days} business day{days === 1 ? "" : "s"} left
          </span>
        ) : null}
      </div>

      <h2 className="tri-title" lang="es">
        {tender.title}
      </h2>
      <p className="tri-meta">
        {[
          tender.buyer_name,
          tender.region,
          sourceLabel(tender.source, tender.link, tender.region),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      {tender.risk ? <RiskNote risk={tender.risk} compact /> : null}

      {stoppers.length ? (
        <ul className="tri-stoppers">
          {stoppers.map((reason) => (
            <li key={reason.text}>
              <span aria-hidden="true">✕</span>{" "}
              {reasonLabel(reason.text, tender.deadline_date)}
            </li>
          ))}
        </ul>
      ) : null}

      {result && "error" in result ? null : (
        <div className="tri-summary">
          {summary ? (
            <>
              <p>{summary.summary}</p>
              {summary.watch_outs.length ? (
                <ul className="tri-watch">
                  {summary.watch_outs.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="tri-summary-wait">Reading the tender…</p>
          )}
        </div>
      )}

      {pros.length || cautions.length ? (
        <ul className="tri-why">
          {pros.map((reason) => (
            <li key={reason.text} className="tri-pro">
              + {reasonLabel(reason.text, tender.deadline_date)}
            </li>
          ))}
          {cautions.map((reason) => (
            <li key={reason.text} className="tri-con">
              – {reasonLabel(reason.text, tender.deadline_date)}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="tri-details">
        <dl>
          {tender.deadline_date ? (
            <div>
              <dt>Deadline</dt>
              <dd>
                {DATE.format(new Date(`${tender.deadline_date}T00:00:00`))}
                {tender.deadline_time
                  ? `, ${tender.deadline_time.slice(0, 5)}`
                  : ""}
              </dd>
            </div>
          ) : null}
          {duration ? (
            <div>
              <dt>Duration</dt>
              <dd>{duration}</dd>
            </div>
          ) : null}
          {tender.procedure_label ? (
            <div>
              <dt>Procedure</dt>
              <dd>{tender.procedure_label}</dd>
            </div>
          ) : null}
          {tender.has_checklist ? (
            <div>
              <dt>Checklist</dt>
              <dd>Ready</dd>
            </div>
          ) : null}
        </dl>
        {summary?.scope.length ? (
          <ul className="tri-scope">
            {summary.scope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {tender.link ? (
          <a
            href={tender.link}
            target="_blank"
            rel="noreferrer"
            className="pane-link"
          >
            Official notice ↗ <kbd>O</kbd>
          </a>
        ) : null}
      </div>
    </>
  );
}

function TriageSummary({
  history,
  remaining,
  onUndoOne,
  onKeepGoing,
  onDecideLater,
  onShowInterested,
  onExit,
}: {
  history: Array<{ tender: FeedTender; choice: Choice }>;
  remaining: number;
  onUndoOne: (id: string) => void;
  onKeepGoing: () => void;
  onDecideLater: (tenders: FeedTender[]) => void;
  onShowInterested: () => void;
  onExit: () => void;
}) {
  const [showPassed, setShowPassed] = useState(false);
  const by = (choice: Choice) =>
    history.filter((item) => item.choice === choice).map((item) => item.tender);
  const interested = by("go");
  const later = by("watch");
  const passed = by("no_go");

  const row = (tender: FeedTender, action?: React.ReactNode) => {
    const days = tender.deadline_date
      ? businessDaysUntil(tender.deadline_date)
      : null;
    return (
      <li key={tender.tender_id}>
        <span className="tri-sum-title">
          <strong>{tender.title}</strong>
          <small>
            {tender.buyer_name}
            {days !== null ? ` · ${days} business days left` : ""}
          </small>
        </span>
        {action}
      </li>
    );
  };

  return (
    <div className="tri-summary-screen">
      <h2>
        {history.length ? `${history.length} reviewed` : "Nothing to review"}
      </h2>
      <p>
        {interested.length} interested · {later.length} for later ·{" "}
        {passed.length} not for us
      </p>

      {interested.length ? (
        <div className="tri-sum-group">
          <h3>Interested</h3>
          <ul>
            {interested.map((tender) =>
              row(
                tender,
                tender.link ? (
                  <a
                    className="link-button link-strong"
                    href={tender.link}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Notice ↗
                  </a>
                ) : null,
              ),
            )}
          </ul>
        </div>
      ) : null}

      {later.length ? (
        <div className="tri-sum-group">
          <h3>Later</h3>
          <ul>{later.map((tender) => row(tender))}</ul>
          <button
            type="button"
            className="link-button link-strong"
            onClick={() => onDecideLater(later)}
          >
            Decide on these now
          </button>
        </div>
      ) : null}

      {passed.length ? (
        <div className="tri-sum-group">
          <button
            type="button"
            className="tri-sum-toggle"
            onClick={() => setShowPassed(!showPassed)}
          >
            Not for us · {passed.length} {showPassed ? "▴" : "▾"}
          </button>
          {showPassed ? (
            <ul>
              {passed.map((tender) =>
                row(
                  tender,
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onUndoOne(tender.tender_id)}
                  >
                    Undo
                  </button>,
                ),
              )}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="tri-sum-actions">
        {remaining > 0 ? (
          <button type="button" className="ob-continue" onClick={onKeepGoing}>
            Keep going · {remaining} more
          </button>
        ) : null}
        {interested.length ? (
          <button
            type="button"
            className={remaining > 0 ? "button pane-secondary" : "ob-continue"}
            onClick={onShowInterested}
          >
            Review {interested.length} interested
          </button>
        ) : null}
        <button type="button" className="ob-back" onClick={onExit}>
          Back to the list
        </button>
      </div>
    </div>
  );
}
