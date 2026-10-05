import type { Breakdown, BreakdownItem, Cite } from "@/lib/breakdown";

// "Can you bid, and how will you be scored?" — must-meet requirements, criteria scored by
// formula, criteria scored by judgement, then what to submit and what gets bids excluded.
export function BidBreakdown({ breakdown }: { breakdown: Breakdown }) {
  const b = breakdown;
  const total = b.totals.price + b.totals.formula + b.totals.judgement;
  const hasScoring = b.price.length + b.formula.length + b.judgement.length > 0;
  return (
    <section className="dec-panel dec-breakdown">
      <h2 className="dec-label">
        Can you bid, and how will you be scored?
        <span className="dec-label-aside">
          {b.source === "checklist"
            ? "From the tender documents, every point linked to its page"
            : "From the official notice. Open the documents for the full detail"}
        </span>
      </h2>

      {hasScoring ? (
        <div className="bd-split" aria-label="How points are split">
          {(
            [
              ["Price", b.totals.price, "bd-seg-price"],
              ["Other formula", b.totals.formula, "bd-seg-formula"],
              ["Judgement", b.totals.judgement, "bd-seg-judgement"],
            ] as const
          )
            .filter(([, points]) => points > 0)
            .map(([label, points, cls]) => (
              <span key={label} className={`bd-seg ${cls}`} style={{ flexGrow: points }}>
                {label} {formatPoints(points)}
                {total ? ` pts` : ""}
              </span>
            ))}
        </div>
      ) : null}

      <div className="bd-columns">
        <Column
          step="1"
          title="Must meet to take part"
          empty="No specific solvency or classification requirement in the notice. Check the admin terms."
          items={b.mustMeet}
        />
        <Column
          step="2"
          title="Scored by formula"
          hint="Price and objective commitments: you know your points before you submit."
          empty="No formula criteria listed."
          items={[...b.price, ...b.formula]}
          showPoints
        />
        <Column
          step="3"
          title="Scored by judgement"
          hint="The technical proposal, rated by the evaluation committee."
          empty="None: no long technical proposal to write."
          items={b.judgement}
          showPoints
        />
      </div>
      {b.lotNote ? <p className="dec-foot">{b.lotNote}</p> : null}

      {b.submitWithBid.length || b.submitIfWin.length || b.exclusions.length || b.watchOut.length ? (
        <div className="bd-columns">
          {b.submitWithBid.length ? <Column title="Submit with your bid" items={b.submitWithBid} checklist /> : null}
          {b.submitIfWin.length ? <Column title="Only if you win" items={b.submitIfWin} checklist /> : null}
          {b.exclusions.length ? <Column title="How bids get thrown out" items={b.exclusions} tone="warn" /> : null}
          {b.watchOut.length ? (
            <div className="bd-col">
              <h3 className="bd-title bd-title-warn">Check before you bid</h3>
              <ul className="bd-list">
                {b.watchOut.map((note) => (
                  <li key={note} className="bd-item">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Column({
  step,
  title,
  hint,
  empty,
  items,
  showPoints,
  checklist,
  tone,
}: {
  step?: string;
  title: string;
  hint?: string;
  empty?: string;
  items: BreakdownItem[];
  showPoints?: boolean;
  checklist?: boolean;
  tone?: "warn";
}) {
  return (
    <div className="bd-col">
      <h3 className={`bd-title${tone ? ` bd-title-${tone}` : ""}`}>
        {step ? <span className="bd-step">{step}</span> : null}
        {title}
      </h3>
      {hint ? <p className="bd-hint">{hint}</p> : null}
      {items.length ? (
        <ul className={checklist ? "bd-list bd-list-check" : "bd-list"}>
          {items.map((item, i) => (
            <li key={`${item.text}-${i}`} className="bd-item">
              <span className="bd-item-head">
                <span lang={item.cite ? undefined : "es"}>{item.text}</span>
                {showPoints && item.points !== null ? <span className="bd-points">{formatPoints(item.points)} pts</span> : null}
              </span>
              {item.detail ? <span className="bd-detail">{item.detail}</span> : null}
              {item.cite ? <CiteLink cite={item.cite} /> : null}
            </li>
          ))}
        </ul>
      ) : empty ? (
        <p className="dec-muted">{empty}</p>
      ) : null}
    </div>
  );
}

function CiteLink({ cite }: { cite: Cite }) {
  const badge = cite.verified === false ? <span className="bd-unverified">check</span> : null;
  const label = (
    <>
      {cite.label}
      {cite.verified ? <span aria-label="quote verified on this page"> ✓</span> : null}
    </>
  );
  return (
    <span className="bd-cite" title={cite.quote ?? undefined}>
      {cite.href ? (
        <a href={cite.href} target="_blank" rel="noreferrer">
          {label} ↗
        </a>
      ) : (
        label
      )}
      {badge}
    </span>
  );
}

function formatPoints(points: number) {
  return Number.isInteger(points) ? String(points) : points.toFixed(1);
}
