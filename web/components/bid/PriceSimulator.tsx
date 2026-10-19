"use client";

import { Suspense, use, useMemo, useRef } from "react";
import type { BidPrice } from "@/lib/bid-prep-server";
import { abnormalFlags, advise, FORMULA_LABEL, pricePoints, simulate, type AbnormalRule, type FormulaKind, type PriceSetup } from "@/lib/price-sim";
import { useStored } from "./plan-store";

// The Price tab: "if we bid X, how many price points do we get, and would we be presumed
// abnormally low?" Rivals are assumed from past winning discounts; every assumption can be
// edited. The chosen discount and edits are kept in this browser.

export type SavedPrice = {
  discount?: number;
  setup?: Partial<PriceSetup>;
  rivals?: number[];
};

export const priceKey = (companyId: string, tenderId: string) => `bidmagnet:price:${companyId}:${tenderId}`;

const EURO = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const MAX = 0.5;
const STEP = 0.005;

export const pct = (discount: number) => {
  const value = Math.round(discount * 1000) / 10;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
};
const pts = (points: number) => (Number.isInteger(points) ? String(points) : points.toFixed(1));
const clampDiscount = (value: number) => Math.min(MAX, Math.max(0, Math.round(value / STEP) * STEP));

type Props = {
  price: Promise<BidPrice>;
  companyId: string;
  tenderId: string;
  priceHref: string | null;
  onAsk: (question: string) => void;
};

export function PriceTab(props: Props) {
  return (
    <Suspense
      fallback={
        <section className="dec-panel price-loading" aria-busy="true">
          <span className="skel" style={{ width: "40%", height: 14 }} />
          <span className="skel" style={{ height: 220 }} />
          <p className="dec-muted">Loading past winning discounts for this buyer and similar contracts…</p>
        </section>
      }
    >
      <PriceSimulator {...props} />
    </Suspense>
  );
}

function PriceSimulator({ price: pending, companyId, tenderId, priceHref, onAsk }: Props) {
  const price = use(pending);
  const [saved, save] = useStored<SavedPrice>(priceKey(companyId, tenderId));

  const setup: PriceSetup = { ...price.setup, ...saved?.setup };
  const rivals = saved?.rivals ?? price.market.rivals;
  const edited = Boolean(saved?.setup || saved?.rivals);
  const setupKey = JSON.stringify([setup, rivals]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialised inputs
  const advice = useMemo(() => advise(setup, { ...price.market, rivals }), [setupKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the serialised inputs
  const rows = useMemo(() => simulate(setup, rivals, 0, MAX, STEP), [setupKey]);

  const discount = saved?.discount ?? advice.sweetSpot?.discount ?? 0.1;
  const best = Math.max(discount, ...rivals.filter((rival) => setup.maxDiscount === null || rival <= setup.maxDiscount + 1e-9));
  const points = pricePoints(setup, discount, best);
  const abnormal = abnormalFlags(setup.abnormal, [discount, ...rivals])[0];
  const overCap = setup.maxDiscount !== null && discount > setup.maxDiscount + 1e-9;
  const offer = setup.budget * (1 - discount);

  const patch = (next: SavedPrice) => save({ ...saved, ...next });
  const patchSetup = (next: Partial<PriceSetup>) => patch({ setup: { ...saved?.setup, ...next } });
  const setDiscount = (value: number) => patch({ discount: clampDiscount(value) });

  const status = overCap
    ? { tone: "bad", text: "Over the cap: 0 price points" }
    : abnormal
      ? { tone: "bad", text: "Presumed abnormally low" }
      : advice.safeMax !== null && advice.safeMax - discount < 0.02
        ? { tone: "warn", text: "Close to the abnormally-low line" }
        : { tone: "ok", text: "Safe" };

  const rivalRows = rivals
    .map((rival, index) => ({
      index,
      rival,
      points: pricePoints(setup, rival, best),
      abnormal: abnormalFlags(setup.abnormal, [discount, ...rivals])[index + 1],
    }))
    .sort((a, b) => b.rival - a.rival);
  const beaten = rivalRows.filter((row) => row.points < points).length;

  return (
    <div className="price">
      <section className="dec-panel price-main" aria-label="Price simulator">
        <h2 className="dec-label">
          Price simulator
          <span className="dec-label-aside">{price.market.basis}</span>
        </h2>

        <div className="price-readout">
          <div>
            <span>Your discount</span>
            <b className="mono">{pct(discount)}</b>
          </div>
          <div>
            <span>Your offer, excl. VAT</span>
            <b className="mono">{EURO.format(offer)}</b>
            <small>{EURO.format(setup.budget - offer)} below the budget</small>
          </div>
          <div>
            <span>Price points</span>
            <b className="mono">
              {pts(points)} <small>/ {pts(setup.maxPoints)}</small>
            </b>
            <small>{rivals.length ? `More than ${beaten} of ${rivals.length} assumed rival${rivals.length === 1 ? "" : "s"}` : "No rivals assumed"}</small>
          </div>
          <div className={`price-status price-status-${status.tone}`} role="status">
            {status.text}
          </div>
        </div>

        <input
          className="price-slider"
          type="range"
          min={0}
          max={MAX * 100}
          step={STEP * 100}
          value={Math.round(discount * 1000) / 10}
          onChange={(event) => setDiscount(Number(event.target.value) / 100)}
          aria-label="Your discount on the budget"
          aria-valuetext={`${pct(discount)} discount, ${pts(points)} points`}
          style={sliderStyle(discount, advice.safeMax, setup.maxDiscount)}
        />

        <PriceChart
          rows={rows}
          setup={setup}
          discount={discount}
          safeMax={advice.safeMax}
          sweet={advice.sweetSpot?.discount ?? null}
          typical={price.market.typical}
          history={price.history}
          onPick={setDiscount}
        />

        <div className="price-picks">
          {advice.sweetSpot ? (
            <button type="button" aria-pressed={discount === advice.sweetSpot.discount} onClick={() => setDiscount(advice.sweetSpot!.discount)}>
              <b>Most points, still safe</b>
              <span className="mono">
                {pct(advice.sweetSpot.discount)} · {pts(advice.sweetSpot.points)} pts
              </span>
            </button>
          ) : null}
          {advice.atTypical ? (
            <button type="button" aria-pressed={discount === advice.atTypical.discount} onClick={() => setDiscount(advice.atTypical!.discount)}>
              <b>What winners usually bid</b>
              <span className="mono">
                {pct(advice.atTypical.discount)} · {pts(advice.atTypical.points)} pts
              </span>
            </button>
          ) : null}
          {advice.safeMax !== null ? (
            <button type="button" aria-pressed={discount === advice.safeMax} onClick={() => setDiscount(advice.safeMax!)}>
              <b>Abnormally-low line</b>
              <span className="mono">{pct(advice.safeMax)}</span>
            </button>
          ) : null}
        </div>

        {advice.notes.length ? (
          <ul className="bid-notes bid-notes-muted">
            {advice.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}

        <div className="bid-ask">
          <span className="bid-ask-label">
            <span aria-hidden="true">✦</span> Ask Scout
          </span>
          <button
            type="button"
            className="bid-ask-chip"
            onClick={() =>
              onAsk(
                `We’re thinking of bidding ${pct(discount)} below the budget (${EURO.format(offer)} excl. VAT). The simulator gives ${pts(points)} of ${pts(setup.maxPoints)} price points. Is that sensible for this tender and buyer?`,
              )
            }
          >
            Is {pct(discount)} off sensible here?
          </button>
          <button
            type="button"
            className="bid-ask-chip"
            onClick={() => onAsk("What does the PCAP say about justifying an abnormally low offer, and what would we have to send?")}
          >
            What if we’re flagged as abnormally low?
          </button>
        </div>
      </section>

      <aside className="dec-panel price-side" aria-label="How price is scored">
        <h2 className="dec-label">How price is scored</h2>
        {price.formulaExplained || price.formulaText ? (
          <div className="price-formula">
            {price.formulaExplained ? <p>{price.formulaExplained}</p> : null}
            {price.formulaText ? <code lang="es">{price.formulaText}</code> : null}
            {price.cite?.page ? (
              priceHref ? (
                <a className="chat-cite" href={priceHref} target="_blank" rel="noreferrer">
                  {price.cite.label}
                </a>
              ) : (
                <span className="chat-cite">{price.cite.label}</span>
              )
            ) : null}
          </div>
        ) : null}
        {!price.setup.formulaKnown ? (
          <p className="price-warn">
            The formula isn’t confirmed for this tender. We’re using the most common one: check the admin terms and pick the right one below.
          </p>
        ) : null}

        {/* Folded unless they need checking: you've edited them, or the formula is a guess. */}
        <details className="price-assume" open={edited || !price.setup.formulaKnown ? true : undefined}>
          <summary>
            <span className="bid-sub">Assumptions</span>
            <small>
              {FORMULA_LABEL[setup.formula]} · {rivals.length} rival{rivals.length === 1 ? "" : "s"}
            </small>
          </summary>
          <div className="price-assume-body">
            <label className="bid-field">
              <span>Formula</span>
              <select value={setup.formula} onChange={(event) => patchSetup({ formula: event.target.value as FormulaKind })}>
                {(Object.keys(FORMULA_LABEL) as FormulaKind[]).map((kind) => (
                  <option key={kind} value={kind}>
                    {FORMULA_LABEL[kind]}
                  </option>
                ))}
              </select>
            </label>
            <div className="bid-field-row">
              <NumberField label="Price points" value={setup.maxPoints} onChange={(value) => value > 0 && patchSetup({ maxPoints: value })} />
              <NumberField label="Budget, excl. VAT (€)" value={setup.budget} step={1000} onChange={(value) => value > 0 && patchSetup({ budget: value })} />
            </div>
            <NumberField
              label="Discount cap (%)"
              value={setup.maxDiscount === null ? null : Math.round(setup.maxDiscount * 1000) / 10}
              placeholder="None"
              onChange={(value) => patchSetup({ maxDiscount: value > 0 ? value / 100 : null })}
            />
            <RuleField rule={setup.abnormal} onChange={(abnormal) => patchSetup({ abnormal })} />
            {price.abnormalText ? (
              <p className="dec-muted" lang="es">
                Abnormally low, per the documents: {price.abnormalText}
              </p>
            ) : null}

            <div className="bid-field">
              <span>Assumed rivals’ discounts</span>
              <ul className="price-rivals">
                {rivalRows.map((row) => (
                  <li key={row.index} className={row.abnormal ? "price-rival-flag" : undefined}>
                    <input
                      type="number"
                      min={0}
                      max={90}
                      step={0.5}
                      value={Math.round(row.rival * 1000) / 10}
                      aria-label={`Rival ${row.index + 1} discount (%)`}
                      onChange={(event) => {
                        const next = [...rivals];
                        next[row.index] = Math.max(0, Math.min(0.9, Number(event.target.value) / 100));
                        patch({ rivals: next });
                      }}
                    />
                    <span className="mono">%</span>
                    <small>{row.abnormal ? "abnormally low" : `${pts(row.points)} pts`}</small>
                    <button
                      type="button"
                      className="price-remove"
                      aria-label={`Remove rival ${row.index + 1}`}
                      onClick={() =>
                        patch({
                          rivals: rivals.filter((_, index) => index !== row.index),
                        })
                      }
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="link-button" onClick={() => patch({ rivals: [...rivals, price.market.typical ?? 0.1] })}>
                Add a rival
              </button>
            </div>

            {edited ? (
              <button
                type="button"
                className="link-button price-reset"
                onClick={() => save(saved?.discount === undefined ? null : { discount: saved.discount })}
              >
                Reset to the tender’s values
              </button>
            ) : null}
          </div>
        </details>
      </aside>
    </div>
  );
}

// The slider track shows the safe range, the risky zone and anything above the cap.
function sliderStyle(discount: number, safeMax: number | null, cap: number | null) {
  const at = (value: number) => `${(value / MAX) * 100}%`;
  const risky = Math.min(MAX, safeMax ?? MAX);
  const capped = Math.min(MAX, cap ?? MAX);
  const edge = Math.min(risky, capped);
  return {
    "--fill": at(discount),
    "--risk": at(edge),
    background: `linear-gradient(to right, var(--dark) 0 ${at(Math.min(discount, edge))}, var(--divider) ${at(Math.min(discount, edge))} ${at(edge)}, var(--error-surface) ${at(edge)} 100%)`,
  } as React.CSSProperties;
}

function NumberField({
  label,
  value,
  step = 1,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  step?: number;
  placeholder?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="bid-field">
      <span>{label}</span>
      <input type="number" min={0} step={step} value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

const RULES: Array<{ kind: AbnormalRule["kind"]; label: string }> = [
  { kind: "rglcap85", label: "Legal default (art. 85)" },
  { kind: "below_mean", label: "Points above the average" },
  { kind: "below_budget", label: "Points below the budget" },
  { kind: "none", label: "No rule" },
];

function RuleField({ rule, onChange }: { rule: AbnormalRule; onChange: (rule: AbnormalRule) => void }) {
  const points = rule.kind === "below_mean" || rule.kind === "below_budget" ? rule.points : null;
  return (
    <div className="bid-field">
      <span>Abnormally low if</span>
      <div className="price-rule">
        <select
          value={rule.kind}
          onChange={(event) => {
            const kind = event.target.value as AbnormalRule["kind"];
            onChange(kind === "below_mean" || kind === "below_budget" ? { kind, points: points ?? (kind === "below_mean" ? 10 : 20) } : { kind });
          }}
        >
          {RULES.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
        {points !== null ? (
          <input
            type="number"
            min={1}
            step={1}
            value={points}
            aria-label="Points"
            onChange={(event) =>
              onChange({
                ...(rule as { kind: "below_mean" | "below_budget" }),
                points: Math.max(1, Number(event.target.value)),
              })
            }
          />
        ) : null}
      </div>
    </div>
  );
}

// Points against discount, with the risky zone shaded and past winning discounts as dots.
const W = 640;
const H = 236;
const PAD = { left: 36, right: 14, top: 14, bottom: 54 };

function PriceChart({
  rows,
  setup,
  discount,
  safeMax,
  sweet,
  typical,
  history,
  onPick,
}: {
  rows: Array<{ discount: number; points: number }>;
  setup: PriceSetup;
  discount: number;
  safeMax: number | null;
  sweet: number | null;
  typical: number | null;
  history: { buyer: number[]; similar: number[] };
  onPick: (discount: number) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (d: number) => PAD.left + (Math.min(MAX, Math.max(0, d)) / MAX) * plotW;
  const y = (p: number) => PAD.top + plotH - (p / setup.maxPoints) * plotH;
  const line = rows.map((row, index) => `${index ? "L" : "M"}${x(row.discount).toFixed(1)},${y(row.points).toFixed(1)}`).join(" ");
  const strip = PAD.top + plotH + 30;
  const mine = rows.reduce((a, row) => (Math.abs(row.discount - discount) < Math.abs(a.discount - discount) ? row : a), rows[0]);
  const risky = safeMax !== null && safeMax < MAX ? safeMax : null;
  const cap = setup.maxDiscount !== null && setup.maxDiscount < MAX ? setup.maxDiscount : null;

  function pick(event: React.PointerEvent<SVGSVGElement>) {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const at = ((event.clientX - box.left) / box.width) * W;
    onPick(((at - PAD.left) / plotW) * MAX);
  }

  return (
    <figure className="price-chart">
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Price points for each discount, with the abnormally-low zone and past winning discounts"
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => dragging.current && pick(event)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        {risky !== null ? <rect className="price-zone-risk" x={x(risky)} y={PAD.top} width={x(MAX) - x(risky)} height={plotH} /> : null}
        {cap !== null ? <rect className="price-zone-cap" x={x(cap)} y={PAD.top} width={x(MAX) - x(cap)} height={plotH} /> : null}
        {[0, 0.5, 1].map((share) => (
          <g key={share}>
            <line className="price-grid" x1={PAD.left} x2={W - PAD.right} y1={y(setup.maxPoints * share)} y2={y(setup.maxPoints * share)} />
            <text className="price-axis" x={PAD.left - 6} y={y(setup.maxPoints * share) + 3} textAnchor="end">
              {pts(Math.round(setup.maxPoints * share * 10) / 10)}
            </text>
          </g>
        ))}
        {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((tick) => (
          <text key={tick} className="price-axis" x={x(tick)} y={PAD.top + plotH + 14} textAnchor="middle">
            {Math.round(tick * 100)}%
          </text>
        ))}
        {risky !== null && (cap === null || risky < cap) ? (
          <text className="price-zone-label" x={x(risky) + 6} y={PAD.top + 12}>
            Abnormally low
          </text>
        ) : null}
        {cap !== null ? (
          <text className="price-axis" x={x(cap) + 6} y={PAD.top + (risky !== null && risky < cap ? 26 : 12)}>
            Over the cap: 0 points
          </text>
        ) : null}
        {typical !== null ? <line className="price-typical" x1={x(typical)} x2={x(typical)} y1={PAD.top} y2={PAD.top + plotH} /> : null}
        <path className="price-line" d={line} />
        {sweet !== null ? <circle className="price-sweet" cx={x(sweet)} cy={y(rows.find((row) => row.discount === sweet)?.points ?? 0)} r={5} /> : null}
        <line className="price-mine" x1={x(discount)} x2={x(discount)} y1={PAD.top} y2={PAD.top + plotH} />
        <circle className="price-mine-dot" cx={x(discount)} cy={y(mine.points)} r={5} />

        <text className="price-axis price-strip-label" x={PAD.left - 6} y={strip + 3} textAnchor="end">
          past
        </text>
        <line className="price-grid" x1={PAD.left} x2={W - PAD.right} y1={strip} y2={strip} />
        {history.similar
          .filter((d) => d >= 0 && d <= MAX)
          .map((d, index) => (
            <circle key={`s${index}`} className="price-dot-similar" cx={x(d)} cy={strip} r={3.5}>
              <title>{`Similar contract won at ${pct(d)}`}</title>
            </circle>
          ))}
        {history.buyer
          .filter((d) => d >= 0 && d <= MAX)
          .map((d, index) => (
            <circle key={`b${index}`} className="price-dot-buyer" cx={x(d)} cy={strip} r={3.5}>
              <title>{`This buyer awarded at ${pct(d)}`}</title>
            </circle>
          ))}
      </svg>
      <figcaption className="price-legend">
        <span>
          <i className="price-key-mine" /> You
        </span>
        <span>
          <i className="price-key-sweet" /> Most points, still safe
        </span>
        {typical !== null ? (
          <span>
            <i className="price-key-typical" /> What winners usually bid
          </span>
        ) : null}
        {history.buyer.length ? (
          <span>
            <i className="price-key-buyer" /> This buyer’s past awards ({history.buyer.length})
          </span>
        ) : null}
        {history.similar.length ? (
          <span>
            <i className="price-key-similar" /> Similar contracts ({history.similar.length})
          </span>
        ) : null}
        <span>Click or drag the chart to try a discount.</span>
      </figcaption>
    </figure>
  );
}
