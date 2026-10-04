"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { businessDaysUntil, euroShort, sourceLabel, type Decision, type FeedTender } from "@/lib/discover";
import { TenderSummaryBlock } from "./TenderSummaryBlock";
import { prefetchSummary } from "./useTenderSummary";

type SwipeDeckProps = {
  tenders: FeedTender[];
  onDecide: (id: string, decision: Decision | null) => void;
  onClose: () => void;
  onShowInterested: () => void;
};

const THRESHOLD = 110; // px of drag that counts as a decision
const FLY_MS = 240;

type Drag = { x: number; y: number; dragging: boolean };

// Tinder-style triage: right = interested, left = not for us.
export function SwipeDeck({ tenders, onDecide, onClose, onShowInterested }: SwipeDeckProps) {
  // The queue is fixed when the deck opens, so deciding doesn't reshuffle it.
  const [queue] = useState(tenders);
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<Array<{ id: string; decision: Decision }>>([]);
  const [drag, setDrag] = useState<Drag>({ x: 0, y: 0, dragging: false });
  const [leaving, setLeaving] = useState<"left" | "right" | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const current = queue[index];

  useEffect(() => {
    queue.slice(index, index + 3).forEach((tender) => prefetchSummary(tender.tender_id));
  }, [queue, index]);

  const decide = useCallback(
    (direction: "left" | "right") => {
      if (!current || leaving) return;
      const decision: Decision = direction === "right" ? "go" : "no_go";
      setLeaving(direction);
      window.setTimeout(() => {
        onDecide(current.tender_id, decision);
        setHistory((items) => [...items, { id: current.tender_id, decision }]);
        setIndex((value) => value + 1);
        setLeaving(null);
        setDrag({ x: 0, y: 0, dragging: false });
      }, FLY_MS);
    },
    [current, leaving, onDecide],
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last || leaving) return;
    onDecide(last.id, null);
    setHistory((items) => items.slice(0, -1));
    setIndex((value) => Math.max(0, value - 1));
  }, [history, leaving, onDecide]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") decide("right");
      else if (event.key === "ArrowLeft") decide("left");
      else if (event.key === "Escape") onClose();
      else if (event.key === "Backspace" || (event.key === "z" && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, undo, onClose]);

  function onPointerDown(event: React.PointerEvent) {
    if ((event.target as HTMLElement).closest("a,button")) return;
    start.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: 0, y: 0, dragging: true });
  }
  function onPointerMove(event: React.PointerEvent) {
    if (!start.current) return;
    setDrag({ x: event.clientX - start.current.x, y: event.clientY - start.current.y, dragging: true });
  }
  function onPointerUp() {
    if (!start.current) return;
    start.current = null;
    if (Math.abs(drag.x) > THRESHOLD) decide(drag.x > 0 ? "right" : "left");
    else setDrag({ x: 0, y: 0, dragging: false });
  }

  const interested = history.filter((item) => item.decision === "go").length;
  const x = leaving ? (leaving === "right" ? 1 : -1) * (typeof window === "undefined" ? 800 : window.innerWidth) : drag.x;
  const y = leaving ? drag.y + 40 : drag.y;
  const lean = Math.max(-1, Math.min(1, x / THRESHOLD));

  return (
    <div className="swipe-backdrop" role="dialog" aria-modal="true" aria-label="Quick triage">
      <div className="swipe-top">
        <span>
          Quick triage · {Math.min(index + 1, queue.length)} of {queue.length}
        </span>
        <button type="button" className="swipe-close" onClick={onClose} aria-label="Close quick triage">
          ×
        </button>
      </div>

      {current ? (
        <>
          <div className="swipe-stack">
            {queue
              .slice(index + 1, index + 3)
              .reverse()
              .map((tender, offset, list) => (
                <div
                  key={tender.tender_id}
                  className="swipe-card swipe-card-behind"
                  style={{ transform: `translateY(${(list.length - offset) * 10}px) scale(${1 - (list.length - offset) * 0.04})` }}
                  aria-hidden="true"
                />
              ))}
            <article
              key={current.tender_id}
              className={`swipe-card${drag.dragging ? " swipe-card-dragging" : ""}`}
              style={{
                transform: `translate(${x}px, ${y}px) rotate(${x / 18}deg)`,
                transition: drag.dragging ? "none" : `transform ${FLY_MS}ms ease-out`,
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <span className="swipe-stamp swipe-stamp-yes" style={{ opacity: Math.max(0, lean) }}>
                Interested
              </span>
              <span className="swipe-stamp swipe-stamp-no" style={{ opacity: Math.max(0, -lean) }}>
                Not for us
              </span>

              <div className="swipe-card-top">
                {current.score !== null ? (
                  <div className="swipe-fit">
                    <span className="mono">{current.score}</span>
                    <span className="fit-bar">
                      <span style={{ width: `${current.score}%` }} />
                    </span>
                  </div>
                ) : null}
                <span className="pane-meta">{sourceLabel(current.source, current.link, current.region)}</span>
              </div>

              <h2>{current.title}</h2>
              <p className="swipe-buyer">{[current.buyer_name, current.region].filter(Boolean).join(" · ")}</p>

              <div className="swipe-facts">
                <div>
                  <span>Budget</span>
                  <strong className="mono">{euroShort(current.budget_no_tax)}</strong>
                </div>
                <div>
                  <span>Closes</span>
                  <strong>
                    {current.deadline_date ? `${businessDaysUntil(current.deadline_date)} business days` : "—"}
                  </strong>
                </div>
              </div>

              <TenderSummaryBlock tenderId={current.tender_id} compact />

              {current.reasons.length ? (
                <ul className="swipe-reasons">
                  {current.reasons
                    .filter((reason) => reason.type !== "ok")
                    .slice(0, 2)
                    .concat(current.reasons.filter((reason) => reason.type === "ok").slice(0, 2))
                    .map((reason) => (
                      <li key={reason.text}>
                        <span className={reason.type === "ok" ? "reason-plus" : "reason-minus"}>
                          {reason.type === "ok" ? "+" : "–"}
                        </span>
                        {reason.text}
                      </li>
                    ))}
                </ul>
              ) : null}
            </article>
          </div>

          <div className="swipe-controls">
            <button type="button" className="swipe-button swipe-button-no" onClick={() => decide("left")} aria-label="Not for us">
              ✕
            </button>
            <button type="button" className="swipe-undo" onClick={undo} disabled={!history.length}>
              ↶ Undo
            </button>
            <button type="button" className="swipe-button swipe-button-yes" onClick={() => decide("right")} aria-label="Interested">
              ✓
            </button>
          </div>
          <p className="swipe-hint">Drag the card, or use ← and → · Esc to close</p>
        </>
      ) : (
        <div className="swipe-done">
          <h2>That&apos;s everything.</h2>
          <p>
            {interested} interested · {history.length - interested} not for us
          </p>
          <div className="swipe-done-actions">
            {interested ? (
              <button type="button" className="welcome-button" onClick={onShowInterested}>
                See interested <span aria-hidden="true">→</span>
              </button>
            ) : null}
            <button type="button" className="swipe-undo" onClick={onClose}>
              Back to the feed
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
