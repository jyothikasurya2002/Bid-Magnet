"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CONTRACT_OPTIONS,
  DEFAULT_FILTERS,
  detailedCount,
  PROCEDURE_OPTIONS,
  WORK_OPTIONS,
  type Filters,
  type Sort,
} from "@/lib/discover";

type FilterBarProps = {
  filters: Filters;
  onChange: (filters: Filters) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
  regions: string[];
  myRegions: string[];
  platforms: string[];
  count: (filters: Filters) => number;
  profileBudget: string;
  aside?: React.ReactNode;
};

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const DEADLINES: Array<[Filters["deadline"], string]> = [
  ["any", "Any deadline"],
  ["time", "Time to prepare"],
  ["soon", "Closing soon"],
];

// General filters in the toolbar; the detailed ones in a "More filters" panel.
export function FilterBar({ filters, onChange, sort, onSort, regions, myRegions, platforms, count, profileBudget, aside }: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const detailed = detailedCount(filters);
  const anyOn = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="fbar">
      <div className="fbar-row">
        <label className="fbar-search">
          <SearchIcon />
          <input
            type="search"
            value={filters.query}
            placeholder="Search titles and buyers"
            aria-label="Search tenders"
            onChange={(event) => set({ query: event.target.value })}
          />
        </label>
        <label className="fbar-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => onSort(event.target.value as Sort)}>
            <option value="fit">Best fit</option>
            <option value="deadline">Closing soonest</option>
            <option value="budget">Largest budget</option>
          </select>
        </label>
        {aside}
      </div>

      <div className="fbar-row fbar-chips">
        <button
          type="button"
          aria-pressed={filters.qualify}
          className={filters.qualify ? "filter-chip filter-chip-on" : "filter-chip"}
          onClick={() => set({ qualify: !filters.qualify })}
          title="Hide tenders that ask for a certificate or classification you don't have"
        >
          Only ones I qualify for
        </button>

        <div className="fbar-seg" role="group" aria-label="Deadline">
          {DEADLINES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.deadline === value}
              onClick={() => set({ deadline: value })}
              title={value === "time" ? "At least 10 business days left" : value === "soon" ? "5 business days or fewer" : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          className={filters.region !== "all" ? "fbar-select fbar-select-on" : "fbar-select"}
          value={filters.region}
          aria-label="Region"
          onChange={(event) => set({ region: event.target.value })}
        >
          <option value="all">All of Spain</option>
          {myRegions.length ? <option value="mine">My regions</option> : null}
          {regions.map((region) => (
            <option key={region} value={region}>
              {region}
            </option>
          ))}
        </select>

        <label className={filters.minFit ? "fbar-fit fbar-fit-on" : "fbar-fit"} title="Hide tenders below this fit score">
          <span>
            Fit <b className="mono">{filters.minFit ? `≥ ${filters.minFit}` : "any"}</b>
          </span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={filters.minFit}
            aria-label="Minimum fit score"
            style={{ "--fill": `${(filters.minFit / 90) * 100}%` } as React.CSSProperties}
            onChange={(event) => set({ minFit: Number(event.target.value) })}
          />
        </label>

        <div className="fbar-more" ref={panelRef}>
          <button
            type="button"
            className={detailed ? "filter-chip filter-chip-on" : "filter-chip"}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            More filters{detailed ? ` · ${detailed}` : ""} <Chevron />
          </button>
          {open ? (
            <MorePanel
              filters={filters}
              set={set}
              platforms={platforms}
              count={count}
              profileBudget={profileBudget}
              onDone={() => setOpen(false)}
            />
          ) : null}
        </div>

        {anyOn ? (
          <button type="button" className="fbar-clear" onClick={() => onChange(DEFAULT_FILTERS)}>
            Clear all
          </button>
        ) : null}
      </div>
    </div>
  );
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function Options({
  options,
  selected,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="fpanel-options">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={selected.includes(option.value)}
          onClick={() => onChange(toggle(selected, option.value))}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<[T, string]>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="fpanel-options">
      {options.map(([option, label]) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="fpanel-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function euros(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

function MorePanel({
  filters,
  set,
  platforms,
  count,
  profileBudget,
  onDone,
}: {
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
  platforms: string[];
  count: (filters: Filters) => number;
  profileBudget: string;
  onDone: () => void;
}) {
  const shown = count(filters);
  return (
    <div className="fpanel" role="dialog" aria-label="More filters">
      <div className="fpanel-grid">
        <section>
          <h3>Kind of work</h3>
          <Options options={WORK_OPTIONS} selected={filters.work} onChange={(work) => set({ work })} />
        </section>
        <section>
          <h3>Contract type</h3>
          <Options options={CONTRACT_OPTIONS} selected={filters.contractType} onChange={(contractType) => set({ contractType })} />
        </section>
        <section>
          <h3>Procedure</h3>
          <Options options={PROCEDURE_OPTIONS} selected={filters.procedure} onChange={(procedure) => set({ procedure })} />
        </section>
        <section>
          <h3>How it’s won</h3>
          <Choice
            options={[
              ["any", "Any"],
              ["price", "Mostly on price"],
              ["quality", "Quality counts"],
            ]}
            value={filters.scoring}
            onChange={(scoring) => set({ scoring })}
          />
          <p className="fpanel-hint">Price ≥ 60 points, or ≥ 40 points scored by judgement.</p>
        </section>
        <section>
          <h3>Budget (excl. VAT)</h3>
          <div className="fpanel-range">
            <input
              inputMode="numeric"
              placeholder="Min €"
              aria-label="Minimum budget"
              value={filters.budgetMin === null ? "" : filters.budgetMin.toLocaleString("es-ES")}
              onChange={(event) => set({ budgetMin: euros(event.target.value) })}
            />
            <span>–</span>
            <input
              inputMode="numeric"
              placeholder="Max €"
              aria-label="Maximum budget"
              value={filters.budgetMax === null ? "" : filters.budgetMax.toLocaleString("es-ES")}
              onChange={(event) => set({ budgetMax: euros(event.target.value) })}
            />
          </div>
          <p className="fpanel-hint">
            Your profile shows {profileBudget}.{" "}
            <Link href="/company#fact-budget">Change</Link>
          </p>
        </section>
        <section>
          <h3>Contract length</h3>
          <Choice
            options={[
              ["any", "Any"],
              ["short", "Up to 1 year"],
              ["mid", "1–3 years"],
              ["long", "3+ years"],
            ]}
            value={filters.duration}
            onChange={(duration) => set({ duration })}
          />
        </section>
        <section>
          <h3>Competition</h3>
          <Check checked={filters.lowCompetition} onChange={(lowCompetition) => set({ lowCompetition })}>
            Few bidders at this buyer
          </Check>
          <Check checked={filters.smallSimplified} onChange={(smallSimplified) => set({ smallSimplified })}>
            Small tenders with no turnover or experience proof
          </Check>
        </section>
        <section>
          <h3>Structure</h3>
          <Check checked={filters.singleContract} onChange={(singleContract) => set({ singleContract })}>
            Single contract (no lots)
          </Check>
          <Check checked={filters.hideFrameworks} onChange={(hideFrameworks) => set({ hideFrameworks })}>
            Hide framework agreements
          </Check>
        </section>
        {platforms.length > 1 ? (
          <section className="fpanel-wide">
            <h3>Platform</h3>
            <Options
              options={platforms.map((platform) => ({ value: platform, label: platform }))}
              selected={filters.platforms}
              onChange={(next) => set({ platforms: next })}
            />
          </section>
        ) : null}
      </div>
      <footer className="fpanel-foot">
        <button
          type="button"
          className="fbar-clear"
          onClick={() =>
            set({
              work: [],
              contractType: [],
              procedure: [],
              scoring: "any",
              budgetMin: null,
              budgetMax: null,
              duration: "any",
              lowCompetition: false,
              smallSimplified: false,
              singleContract: false,
              hideFrameworks: false,
              platforms: [],
            })
          }
        >
          Reset these
        </button>
        <button type="button" className="fpanel-done" onClick={onDone}>
          Show {shown} tender{shown === 1 ? "" : "s"}
        </button>
      </footer>
    </div>
  );
}
