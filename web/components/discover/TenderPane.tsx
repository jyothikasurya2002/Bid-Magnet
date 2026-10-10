"use client";

import { useEffect, useState } from "react";
import {
  businessDaysUntil,
  durationLabel,
  reasonLabel,
  sourceLabel,
  weighting,
  type Decision,
  type FeedTender,
} from "@/lib/discover";
import { createClient } from "@/lib/supabase/client";
import { RiskNote } from "./RiskNote";
import { TenderSummaryBlock } from "./TenderSummaryBlock";
import { dateFormat } from "@/lib/dates";

type TenderPaneProps = {
  tender: FeedTender;
  decision: Decision | undefined;
  onDecide: (decision: Decision | null) => void;
  onClose: () => void;
  // false when the pane opened on its own (first row on page load)
  autoSummary?: boolean;
};

const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const DEADLINE = dateFormat({ weekday: true });
const LONG_DATE = dateFormat({ year: "numeric" });

type Criterion = { type: string | null; weight: number | null; lot_id: string | null };
const criteriaCache = new Map<string, Criterion[]>();

function useCriteria(id: string) {
  const [loaded, setLoaded] = useState<Record<string, Criterion[]>>({});
  useEffect(() => {
    if (loaded[id] || criteriaCache.has(id)) return;
    let active = true;
    void createClient()
      .from("tender_criteria")
      .select("type,weight,lot_id")
      .eq("tender_id", id)
      .then(({ data }: { data: Criterion[] | null }) => {
        criteriaCache.set(id, data || []);
        if (active) setLoaded((current) => ({ ...current, [id]: data || [] }));
      });
    return () => {
      active = false;
    };
  }, [id, loaded]);
  return criteriaCache.get(id) ?? loaded[id] ?? null;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pane-fact">
      <span>{label}</span>
      <span>{children}</span>
    </div>
  );
}

export function TenderPane({ tender, decision, onDecide, onClose, autoSummary = true }: TenderPaneProps) {
  const criteria = useCriteria(tender.tender_id);
  const weights = criteria ? weighting(criteria) : null;
  const duration = durationLabel(tender.duration, tender.duration_unit);
  const source = sourceLabel(tender.source, tender.link, tender.region);
  const reasons = [...tender.reasons].sort((a, b) => Number(b.type === "ok") - Number(a.type === "ok"));

  return (
    <aside className="tender-pane" aria-labelledby="pane-title">
      <div className="pane-head">
        <div className="pane-tags">
          {tender.kind === "renewal" ? <span className="tag-badge tag-good">Renewal</span> : null}
          {tender.kind === "signal" ? <span className="tag-badge">Early signal</span> : null}
          {tender.has_checklist ? <span className="tag-badge tag-good">Checklist ready</span> : null}
          <span className="pane-meta">
            {[source, tender.procedure_label].filter(Boolean).join(" · ")}
          </span>
          <button type="button" className="pane-close" onClick={onClose} aria-label="Close preview">
            ×
          </button>
        </div>
        <h2 id="pane-title">{tender.title}</h2>
        <p>{[tender.buyer_name, tender.region].filter(Boolean).join(" · ")}</p>
        {tender.link ? (
          <a className="pane-link" href={tender.link} target="_blank" rel="noreferrer">
            Official notice ↗
          </a>
        ) : null}
      </div>

      {tender.risk ? <RiskNote risk={tender.risk} /> : null}

      <div className="pane-facts">
        {tender.kind === "renewal" ? (
          <>
            <Fact label="Current contract">
              <span className="mono">{tender.budget_no_tax !== null ? EURO.format(tender.budget_no_tax) : "Not given"}</span>
            </Fact>
            <Fact label="Expected to end">
              {tender.estimated_end ? LONG_DATE.format(new Date(`${tender.estimated_end}T00:00:00`)) : "—"}
            </Fact>
            <Fact label="Current supplier">{tender.incumbent || "—"}</Fact>
            <Fact label="Duration">{duration || "—"}</Fact>
          </>
        ) : (
          <>
            <Fact label="Budget (excl. VAT)">
              <span className="mono">{tender.budget_no_tax !== null ? EURO.format(tender.budget_no_tax) : "Not given"}</span>
            </Fact>
            <Fact label="Duration">{duration || "—"}</Fact>
            <Fact label="Deadline">
              {tender.deadline_date ? (
                <>
                  {DEADLINE.format(new Date(`${tender.deadline_date}T00:00:00`))}
                  {tender.deadline_time ? `, ${tender.deadline_time.slice(0, 5)}` : ""}
                  <small className="pane-fact-sub">{businessDaysUntil(tender.deadline_date)} business days left</small>
                </>
              ) : (
                "—"
              )}
            </Fact>
            <Fact label="Award weighting">
              {weights ? `${weights.formula} formula · ${weights.judgement} judgement` : criteria ? "Not published" : "…"}
            </Fact>
          </>
        )}
      </div>

      <TenderSummaryBlock tenderId={tender.tender_id} auto={autoSummary} />

      {reasons.length ? (
        <div className="pane-reasons">
          <h3>Why it matches · {tender.score}</h3>
          {reasons.map((reason) => (
            <div className="pane-reason" key={reason.text}>
              <span className={reason.type === "ok" ? "reason-plus" : "reason-minus"}>
                {reason.type === "ok" ? "+" : "–"}
              </span>
              <span>{reasonLabel(reason.text, tender.deadline_date)}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="pane-actions">
        {decision ? (
          <div className="pane-decided">
            <span>
              {decision === "go" ? "Marked interested" : decision === "no_go" ? "Dismissed" : "Watching"}
            </span>
            <button type="button" className="link-button" onClick={() => onDecide(null)}>
              Undo
            </button>
          </div>
        ) : (
          <>
            <button type="button" className="button button-dark pane-primary" onClick={() => onDecide(tender.kind === "renewal" ? "watch" : "go")}>
              {tender.kind === "renewal" ? "Watch this renewal" : "Interested"}
            </button>
            <button type="button" className="button pane-secondary" onClick={() => onDecide("no_go")}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
