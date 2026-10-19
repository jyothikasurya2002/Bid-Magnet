"use client";

import { useState } from "react";
import {
  applyFilters,
  businessDaysUntil,
  closesLabel,
  DEFAULT_FILTERS,
  euroShort,
  filterSummary,
  sortTenders,
  sourceLabel,
  TRIAGE_BATCH,
  type Decision,
  type FeedTender,
  type Filters,
  type Sort,
} from "@/lib/discover";
import { createClient } from "@/lib/supabase/client";
import { FilterBar } from "./FilterBar";
import { FocusMode } from "./FocusMode";
import { TenderPane } from "./TenderPane";
import { dateFormat, SPAIN_TIME } from "@/lib/dates";

type DiscoverFeedProps = {
  companyId: string;
  budget: [number | null, number | null];
  myRegions: string[];
  open: FeedTender[];
  renewals: FeedTender[];
  signals: FeedTender[];
  initialDecisions: Record<string, Decision>;
  updatedAt: string | null;
};

type Tab = "open" | "interested" | "renewals" | "signals" | "dismissed";

// Triage follows the list's Sort.
const TRIAGE_ORDER: Record<Sort, string> = {
  fit: "best fit first",
  deadline: "closing soonest first",
  budget: "largest first",
};

const SHORT_DATE = dateFormat({});
const TIME = SPAIN_TIME;

export function DiscoverFeed({
  companyId,
  budget,
  myRegions,
  open,
  renewals,
  signals,
  initialDecisions,
  updatedAt,
}: DiscoverFeedProps) {
  const [decisions, setDecisions] = useState(initialDecisions);
  const [tab, setTab] = useState<Tab>("open");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<Sort>("fit");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paneOpen, setPaneOpen] = useState(true);
  // Triage runs on the same filters and sort as the list.
  const [focus, setFocus] = useState(false);
  const [error, setError] = useState("");

  const everything = [...open, ...renewals, ...signals];
  const undecided = open.filter((tender) => tender.score !== null && !decisions[tender.tender_id]);
  const regionOptions = [...new Set(undecided.map((tender) => tender.region).filter((region): region is string => Boolean(region)))].sort(
    (a, b) => a.localeCompare(b, "es"),
  );
  const platformOptions = [...new Set(undecided.map((tender) => sourceLabel(tender.source, tender.link, tender.region)))].sort();
  const lists: Record<Tab, FeedTender[]> = {
    open: sortTenders(applyFilters(undecided, filters, myRegions), sort),
    interested: everything.filter((tender) => decisions[tender.tender_id] === "go" || decisions[tender.tender_id] === "watch"),
    renewals: renewals.filter((tender) => decisions[tender.tender_id] !== "no_go"),
    signals: signals.filter((tender) => !decisions[tender.tender_id]),
    dismissed: everything.filter((tender) => decisions[tender.tender_id] === "no_go"),
  };
  // A tender can appear in more than one source list; show it once.
  const rows = lists[tab].filter(
    (tender, index, list) => list.findIndex((other) => other.tender_id === tender.tender_id) === index,
  );
  const selected = paneOpen
    ? (rows.find((tender) => tender.tender_id === selectedId) ?? rows[0] ?? null)
    : null;

  async function decide(id: string, decision: Decision | null, reason?: string) {
    const previous = decisions[id];
    setError("");
    setDecisions((current) => {
      const next = { ...current };
      if (decision) next[id] = decision;
      else delete next[id];
      return next;
    });
    const table = createClient().from("tender_decisions");
    const { error: saveError } = decision
      ? await table.upsert(
          { company_id: companyId, tender_id: id, decision, reason: reason ?? null, decided_at: new Date().toISOString() },
          { onConflict: "company_id,tender_id" },
        )
      : await table.delete().eq("company_id", companyId).eq("tender_id", id);
    if (saveError) {
      setError(`That decision didn't save: ${saveError.message}`);
      setDecisions((current) => {
        const next = { ...current };
        if (previous) next[id] = previous;
        else delete next[id];
        return next;
      });
    }
  }

  // After deciding from the pane, move on to the next row of the same list.
  function decideSelected(decision: Decision | null) {
    if (!selected) return;
    const index = rows.findIndex((tender) => tender.tender_id === selected.tender_id);
    if (decision) setSelectedId(rows[index + 1]?.tender_id ?? rows[index - 1]?.tender_id ?? null);
    void decide(selected.tender_id, decision);
  }

  const tabs: Array<[Tab, string]> = [
    ["open", `Open · ${lists.open.length}`],
    ["interested", `Interested · ${lists.interested.length}`],
    ["renewals", `Renewals · ${lists.renewals.length}`],
    ["signals", `Early signals · ${lists.signals.length}`],
    ["dismissed", "Dismissed"],
  ];

  const budgetLabel =
    budget[0] === null && budget[1] === null
      ? "contracts of any size"
      : `${euroShort(budget[0] ?? 0)} – ${budget[1] === null ? "no limit" : euroShort(budget[1])}`;

  const filterBarProps = {
    filters,
    onChange: setFilters,
    sort,
    onSort: setSort,
    regions: regionOptions,
    myRegions,
    platforms: platformOptions,
    count: (next: Filters) => applyFilters(undecided, next, myRegions).length,
    profileBudget: budgetLabel,
  };

  if (focus) {
    return (
      <div className="discover discover-focus">
        <FocusMode
          queue={lists.open}
          queueKey={JSON.stringify([filters, sort])}
          filterBar={<FilterBar {...filterBarProps} />}
          filterSummary={filterSummary(filters, sort)}
          onDecide={(id, decision, reason) => void decide(id, decision, reason)}
          onExit={() => setFocus(false)}
          onShowInterested={() => {
            setFocus(false);
            setTab("interested");
            setSelectedId(null);
            setPaneOpen(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`discover${selected ? " discover-with-pane" : ""}`}>
      <div className="discover-main">
        <div className="discover-head">
          <div className="discover-tabs" role="tablist" aria-label="Tender lists">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "discover-tab discover-tab-active" : "discover-tab"}
                onClick={() => {
                  setTab(key);
                  setSelectedId(null);
                }}
              >
                {label}
              </button>
            ))}
            <span className="discover-updated">
              {updatedAt ? `Updated ${TIME.format(new Date(updatedAt))} · ` : ""}national + regional platforms
            </span>
          </div>

          {tab === "open" ? (
            <FilterBar
              {...filterBarProps}
              aside={
                <>
                  {lists.open.length ? (
                    <button
                      type="button"
                      className="swipe-launch"
                      onClick={() => setFocus(true)}
                      title="Goes through the list in the order chosen in Sort"
                    >
                      <span className="swipe-launch-icon" aria-hidden="true">
                        <span />
                        <span />
                      </span>
                      Triage {Math.min(TRIAGE_BATCH, lists.open.length)} · {TRIAGE_ORDER[sort]}
                    </button>
                  ) : null}
                </>
              }
            />
          ) : null}
          {error ? (
            <p className="discover-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="feed" role="list">
          <div className="feed-row feed-head" aria-hidden="true">
            <span>{tab === "renewals" ? "" : "Fit"}</span>
            <span>Tender · buyer</span>
            <span>Source</span>
            <span>Value</span>
            <span>{tab === "renewals" ? "Ends" : "Closes"}</span>
          </div>

          {rows.map((tender) => {
            const days = tender.deadline_date ? businessDaysUntil(tender.deadline_date) : null;
            const isSelected = selected?.tender_id === tender.tender_id;
            return (
              <button
                key={tender.tender_id}
                type="button"
                role="listitem"
                className={isSelected ? "feed-row feed-row-selected" : "feed-row"}
                onClick={() => {
                  setSelectedId(tender.tender_id);
                  setPaneOpen(true);
                }}
              >
                <span className="feed-fit">
                  {tender.score !== null ? (
                    <>
                      <span className="mono">{tender.score}</span>
                      <span className="fit-bar">
                        <span style={{ width: `${tender.score}%` }} />
                      </span>
                    </>
                  ) : null}
                </span>
                <span className="feed-title">
                  <span className="feed-title-line">
                    <span className="feed-title-text">{tender.title}</span>
                    {tender.kind === "renewal" ? <span className="tag-badge tag-good">Renewal</span> : null}
                    {tender.kind === "signal" ? <span className="tag-badge">Early signal</span> : null}
                    {tender.has_checklist ? <span className="tag-badge tag-good">Checklist</span> : null}
                  </span>
                  <span className="feed-buyer">
                    {tender.kind === "renewal" && tender.incumbent
                      ? `${tender.buyer_name} · held by ${tender.incumbent}`
                      : tender.buyer_name}
                  </span>
                </span>
                <span className="feed-source">{sourceLabel(tender.source, tender.link, tender.region)}</span>
                <span className="feed-value mono">{euroShort(tender.budget_no_tax)}</span>
                <span className="feed-closes">
                  {tender.kind === "renewal" ? (
                    <span>{tender.estimated_end ? SHORT_DATE.format(new Date(`${tender.estimated_end}T00:00:00`)) : "—"}</span>
                  ) : tender.deadline_date ? (
                    <>
                      <span>{closesLabel(tender.deadline_date).date}</span>
                      <small className={days !== null && days <= 8 ? "feed-urgent" : undefined}>
                        {closesLabel(tender.deadline_date).left}
                      </small>
                    </>
                  ) : (
                    <>
                      <span>—</span>
                      <small>{tender.kind === "signal" ? "Prior notice" : ""}</small>
                    </>
                  )}
                </span>
              </button>
            );
          })}

          {!rows.length ? (
            <div className="feed-empty">
              {tab === "open"
                ? open.length
                  ? "Nothing left with these filters. Try switching one off."
                  : "No open tenders match your profile yet. Add sector codes, keywords or a description on your company page."
                : tab === "interested"
                  ? "Tenders you mark as interested land here."
                  : tab === "dismissed"
                    ? "Nothing dismissed."
                    : tab === "renewals"
                      ? "No contracts in your sectors and regions end in the next nine months."
                      : "No prior notices in your sectors right now."}
            </div>
          ) : null}
        </div>
      </div>

      {selected ? (
        <TenderPane
          key={selected.tender_id}
          tender={selected}
          decision={decisions[selected.tender_id]}
          onDecide={decideSelected}
          onClose={() => setPaneOpen(false)}
          autoSummary={selectedId !== null}
        />
      ) : null}


    </div>
  );
}
