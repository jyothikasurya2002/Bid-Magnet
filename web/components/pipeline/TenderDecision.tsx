"use client";

import Link from "next/link";
import { PartnersPanel } from "./PartnersPanel";
import type { PartnerCandidate } from "@/lib/partners";
import { useState, useSyncExternalStore } from "react";
import { TenderSummaryBlock } from "@/components/discover/TenderSummaryBlock";
import { businessDaysUntil, isStillOpen, reasonLabel, type Decision } from "@/lib/discover";
import { tidyName, type DecisionData, type Rival } from "@/lib/pipeline";
import { createClient } from "@/lib/supabase/client";
import type { MatchReason } from "@/lib/types";
import { TenderChat } from "./TenderChat";
import { dateFormat } from "@/lib/dates";

const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const DAY = dateFormat({});
const MONTH = dateFormat({ day: false, year: "2-digit" });
const LONG = dateFormat({ year: "numeric" });
const pct = (value: number) => `${Math.round(value * 100)}%`;

const CHOICES: Array<{ value: Decision; label: string }> = [
  { value: "no_go", label: "Not for us" },
  { value: "watch", label: "Later" },
  { value: "go", label: "Interested" },
];

const subscribeNothing = () => () => {};

// 3a: score, buyer, rivals and price in one view, with the AI chat alongside.
export function TenderDecision({
  data,
  openChat,
  partners = [],
}: {
  data: DecisionData;
  openChat: boolean;
  partners?: PartnerCandidate[];
}) {
  const { tender } = data;
  const [decision, setDecision] = useState<Decision | null>(data.decision);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [chat, setChat] = useState<boolean | null>(null);
  // The chat reads saved conversations from this browser, so it only mounts after hydration.
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const chatOpen = chat ?? openChat;

  const days = tender.deadline ? businessDaysUntil(tender.deadline) : null;
  const closed = !isStillOpen(tender.deadline);

  async function decide(next: Decision) {
    if (saving || next === decision) return;
    const previous = decision;
    setDecision(next);
    setSaving(true);
    setError("");
    const { error: saveError } = await createClient()
      .from("tender_decisions")
      .upsert(
        { company_id: data.companyId, tender_id: tender.id, decision: next, decided_at: new Date().toISOString() },
        { onConflict: "company_id,tender_id" },
      );
    setSaving(false);
    if (saveError) {
      setDecision(previous);
      setError(`That didn't save: ${saveError.message}`);
    }
  }

  return (
    <div className={chatOpen ? "dec-layout dec-layout-chat" : "dec-layout"}>
      <main className="dec">
        <Link href="/pipeline" className="dec-back">
          ← Pipeline
        </Link>

        <header className="dec-head">
          <div className="dec-title">
            <span className="dec-kicker">
              {[
                tender.buyer,
                tender.budget !== null ? EURO.format(tender.budget) : null,
                tender.deadline
                  ? `closes ${DAY.format(new Date(`${tender.deadline}T00:00:00`))}${tender.deadlineTime ? `, ${tender.deadlineTime.slice(0, 5)}` : ""}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              {days !== null ? (
                <span className={closed || days <= 5 ? "dec-days dec-days-urgent" : "dec-days"}>
                  {closed ? "Closed: too late to bid" : `${days} business day${days === 1 ? "" : "s"} left`}
                </span>
              ) : null}
            </span>
            <h1 lang="es" title={tender.title}>
              {tender.title}
            </h1>
            <p className="dec-facts">
              {[tender.procedure, tender.duration, tender.region, tender.platform].filter(Boolean).join(" · ")}
              {tender.link ? (
                <>
                  {" · "}
                  <a href={tender.link} target="_blank" rel="noreferrer">
                    Official notice ↗
                  </a>
                </>
              ) : null}
            </p>
          </div>

          <div className="dec-actions">
            <button type="button" className="dec-ask" onClick={() => setChat(!chatOpen)} aria-expanded={chatOpen}>
              <span aria-hidden="true">✦</span> Ask AI about this tender
            </button>
            <div className="dec-choice" role="group" aria-label="Your decision">
              {CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  aria-pressed={decision === choice.value}
                  className={`dec-choice-${choice.value}`}
                  onClick={() => decide(choice.value)}
                >
                  {decision === choice.value ? <span aria-hidden="true">✓ </span> : null}
                  {choice.label}
                </button>
              ))}
            </div>
          </div>
        </header>
        {error ? (
          <p className="dec-error" role="alert">
            {error}
          </p>
        ) : decision === "no_go" ? (
          <p className="dec-note" role="status">
            Out of your pipeline. You’ll still find it under Dismissed in Discover.
          </p>
        ) : null}

        <TenderSummaryBlock tenderId={tender.id} compact />

        <div className="dec-grid">
          <FitPanel score={data.score} reasons={data.reasons} deadline={tender.deadline} />
          <BuyerPanel data={data} />
          <RivalsPanel rivals={data.rivals} similarCount={data.similarCount} hasBuyer={Boolean(data.buyer)} />
          <PricePanel data={data} />
          <PartnersPanel partners={partners} gaps={data.reasons.filter((reason) => reason.type === "gap").length} />
        </div>
      </main>

      {hydrated ? (
        <TenderChat
          companyId={data.companyId}
          tenderId={tender.id}
          documents={data.documents}
          open={chatOpen}
          onClose={() => setChat(false)}
        />
      ) : null}
    </div>
  );
}

function Panel({ title, className, children }: { title: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`dec-panel${className ? ` ${className}` : ""}`}>
      <h2 className="dec-label">{title}</h2>
      {children}
    </section>
  );
}

// Colour by effect on the score: a "warn" can still add points.
function factorTone(reason: MatchReason) {
  if (reason.type === "gap") return "gap";
  return reason.points > 0 ? "ok" : reason.points < 0 ? "warn" : "zero";
}

function FitPanel({ score, reasons, deadline }: { score: number | null; reasons: MatchReason[]; deadline: string | null }) {
  const sorted = [...reasons].sort((a, b) => b.points - a.points);
  const largest = Math.max(1, ...reasons.map((reason) => Math.abs(reason.points)));
  return (
    <Panel title="Fit score" className="dec-fit">
      {score !== null ? (
        <>
          <div className="dec-score">
            <span className="mono">{score}</span>
            <small>/ 100</small>
          </div>
          <p className="dec-muted">Every point comes from one of the reasons below.</p>
          <ul className="dec-factors">
            {sorted.map((reason) => (
              <li key={reason.text} className={`dec-factor dec-factor-${factorTone(reason)}`}>
                <div>
                  <span>
                    {reason.type === "gap" ? <b>Dealbreaker · </b> : null}
                    {reasonLabel(reason.text, deadline)}
                  </span>
                  <span className="mono">
                    {reason.points > 0 ? `+${reason.points}` : reason.points < 0 ? `−${Math.abs(reason.points)}` : "0"}
                  </span>
                </div>
                <span className="dec-bar" aria-hidden="true">
                  <span style={{ width: `${Math.max(2, (Math.abs(reason.points) / largest) * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="dec-muted">No fit score: scores are only worked out for open tenders.</p>
      )}
    </Panel>
  );
}

function BuyerPanel({ data }: { data: DecisionData }) {
  const { buyer, previous } = data;
  return (
    <Panel title={`Buyer · ${data.tender.buyer ?? "unknown"}`}>
      {buyer ? (
        <div className="dec-stats">
          <div>
            <span className="mono">{buyer.itTenders}</span>
            <small>IT tenders this year</small>
          </div>
          <div>
            <span className="mono">{buyer.medianDiscount !== null ? pct(buyer.medianDiscount) : "—"}</span>
            <small title={buyer.medianDiscount !== null ? `From ${buyer.discountSample} priced awards` : undefined}>
              {buyer.medianDiscount !== null ? "median winning discount" : "too few priced awards"}
            </small>
          </div>
          <div>
            <span className="mono">{buyer.medianBidders ?? "—"}</span>
            <small>median bidders</small>
          </div>
        </div>
      ) : (
        <p className="dec-muted">No award history for this buyer in our data (Jan–Sep 2026).</p>
      )}
      <p className="dec-previous">
        {previous ? (
          <>
            <strong>Last similar contract here:</strong>{" "}
            {previous.winner ? <>won by {tidyName(previous.winner)}</> : "awarded"}
            {previous.date ? ` on ${LONG.format(new Date(previous.date))}` : ""}
            {previous.discount !== null ? `, ${pct(previous.discount)} below budget` : ""}
            {previous.bidders ? `, ${previous.bidders} bidder${previous.bidders === 1 ? "" : "s"}` : ""}.
            <span className="dec-previous-title" lang="es">
              {previous.title}
            </span>
          </>
        ) : (
          <>No similar contract from this buyer in our data, so there’s no obvious incumbent.</>
        )}
      </p>
    </Panel>
  );
}

function RivalsPanel({ rivals, similarCount, hasBuyer }: { rivals: Rival[]; similarCount: number; hasBuyer: boolean }) {
  const largest = Math.max(1, ...rivals.map((rival) => rival.similarWins + rival.buyerWins));
  return (
    <Panel title="Who wins this kind of work">
      {rivals.length ? (
        <>
          <ul className="dec-rivals">
            {rivals.map((rival) => (
              <li key={rival.key}>
                <span className="dec-rival-name">{tidyName(rival.name)}</span>
                <span className="dec-rival-count">
                  {[
                    rival.similarWins ? `${rival.similarWins} similar won` : null,
                    rival.buyerWins ? `${rival.buyerWins} won here` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="dec-bar dec-bar-dark" aria-hidden="true">
                  <span style={{ width: `${((rival.similarWins + rival.buyerWins) / largest) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <p className="dec-foot">
            Winners of the {similarCount} most similar past contracts{hasBuyer ? ", plus this buyer’s top suppliers" : ""}.
          </p>
        </>
      ) : (
        <p className="dec-muted">No past awards like this one in our data yet.</p>
      )}
    </Panel>
  );
}

function PricePanel({ data }: { data: DecisionData }) {
  const { discounts, medianDiscount } = data;
  const top = Math.max(0.25, ...discounts.map((point) => point.discount)) * 1.1;
  return (
    <Panel
      className="dec-price"
      title={
        <>
          <span>Winning discounts · {data.discountScope === "buyer" ? "this buyer’s IT awards" : "similar contracts elsewhere"}</span>
          {data.pricePoints ? (
            <span className="dec-label-aside">
              Price is {data.pricePoints} pts{data.judgementPoints ? ` · judgement ${data.judgementPoints} pts` : ""}
            </span>
          ) : null}
        </>
      }
    >
      {discounts.length ? (
        <>
          <div className="dec-chart" role="img" aria-label={`Winning discounts, median ${medianDiscount !== null ? pct(medianDiscount) : "unknown"}`}>
            {medianDiscount !== null ? (
              <div className="dec-chart-median" style={{ bottom: `calc(${(Math.max(0, medianDiscount) / top) * 100}% - ${(Math.max(0, medianDiscount) / top) * 18}px)` }}>
                <span>median of these {pct(medianDiscount)}</span>
              </div>
            ) : null}
            {discounts.map((point) => (
              <div key={point.tender_id} className="dec-chart-col" title={`${point.title}${point.winner ? ` · ${tidyName(point.winner)}` : ""}`}>
                <small className="mono">{pct(point.discount)}</small>
                <span style={{ height: `${Math.max(1.5, (Math.max(0, point.discount) / top) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="dec-chart-axis">
            {discounts.map((point) => (
              <span key={point.tender_id}>{MONTH.format(new Date(`${point.date}T00:00:00`))}</span>
            ))}
          </div>
        </>
      ) : (
        <p className="dec-muted">Not enough priced awards to chart yet.</p>
      )}
      {data.priceNote || data.abnormallyLow ? (
        <div className="dec-price-notes">
          {data.priceNote ? <p>{data.priceNote}</p> : null}
          {data.abnormallyLow ? (
            <p className="dec-warn">
              <strong>Abnormally low:</strong> {data.abnormallyLow}
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
