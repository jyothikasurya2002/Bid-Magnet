"use client";

import { useState } from "react";
import type { TenderMatch } from "@/lib/types";

type DiscoverFeedProps = {
  matches: TenderMatch[];
};

function euros(value: number | null) {
  if (value == null) return "Not stated";
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    notation: value >= 1_000_000 ? "compact" : "standard",
  }).format(value);
}

function dateLabel(value: string | null) {
  if (!value) return "No deadline";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T12:00:00`));
}

export function DiscoverFeed({ matches }: DiscoverFeedProps) {
  const [selectedId, setSelectedId] = useState(matches[0]?.tender_id);
  const selected = matches.find((match) => match.tender_id === selectedId) || matches[0];

  if (!matches.length) {
    return (
      <section className="feed-panel empty-state">
        <h2>No matching open tenders yet</h2>
        <p>
          Add CPV areas or service keywords to your company profile, then return
          here to refresh your matches.
        </p>
        <a className="button button-primary" href="/onboarding">
          Improve company profile
        </a>
      </section>
    );
  }

  return (
    <div className="discover-layout">
      <section className="feed-panel" aria-label="Ranked tender matches">
        <div className="feed-toolbar">
          <strong>{matches.length} ranked matches</strong>
          <span className="badge">Best fit first</span>
        </div>
        <div className="feed-list">
          {matches.map((match) => (
            <button
              type="button"
              className={`tender-row ${
                selected?.tender_id === match.tender_id ? "tender-row-selected" : ""
              }`}
              key={match.tender_id}
              onClick={() => setSelectedId(match.tender_id)}
              aria-pressed={selected?.tender_id === match.tender_id}
            >
              <span className="fit-score">{match.score}</span>
              <span className="tender-main">
                <strong>{match.title}</strong>
                <span>{match.buyer_name || "Buyer not stated"}</span>
                <span>
                  {match.source === "regional" ? "Regional platform" : "PLACSP"}
                  {match.region ? ` · ${match.region}` : ""}
                </span>
              </span>
              <span className="tender-meta">{euros(match.budget_no_tax)}</span>
              <span className="tender-meta">
                {dateLabel(match.deadline_date)}
                {match.days_left != null ? ` · ${match.days_left}d` : ""}
              </span>
            </button>
          ))}
        </div>
      </section>

      {selected ? (
        <aside className="preview-pane" aria-label="Selected tender preview">
          <div className="preview-head">
            <div className="button-row">
              <span className="badge badge-success">{selected.score} fit</span>
              <span className="badge">
                {selected.source === "regional" ? "Regional" : "PLACSP"}
              </span>
              {selected.has_checklist ? (
                <span className="badge">Checklist ready</span>
              ) : null}
            </div>
            <h2>{selected.title}</h2>
            <p>{selected.buyer_name || "Buyer not stated"}</p>
          </div>
          <div className="preview-stats">
            <div className="preview-stat">
              <small>Budget</small>
              <strong>{euros(selected.budget_no_tax)}</strong>
            </div>
            <div className="preview-stat">
              <small>Deadline</small>
              <strong>{dateLabel(selected.deadline_date)}</strong>
            </div>
            <div className="preview-stat">
              <small>Procedure</small>
              <strong>{selected.procedure_label || "Not stated"}</strong>
            </div>
            <div className="preview-stat">
              <small>Time left</small>
              <strong>
                {selected.days_left == null ? "Unknown" : `${selected.days_left} days`}
              </strong>
            </div>
          </div>
          <ul className="reason-list">
            {selected.reasons.slice(0, 6).map((reason, index) => (
              <li className={`reason reason-${reason.type}`} key={`${reason.text}-${index}`}>
                <span className="reason-icon">
                  {reason.type === "ok" ? "+" : reason.type === "gap" ? "−" : "!"}
                </span>
                <span>{reason.text}</span>
              </li>
            ))}
          </ul>
          <div className="preview-actions">
            {selected.link ? (
              <a
                className="button button-primary"
                href={selected.link}
                target="_blank"
                rel="noreferrer"
              >
                View official tender
              </a>
            ) : null}
            <a className="button button-secondary" href="/onboarding">
              Edit profile
            </a>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
