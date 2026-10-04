"use client";

import { useId, useState, type ReactNode } from "react";
import { formatEuros, parseEuros } from "@/lib/onboarding";
import type { ImportSuggestion } from "@/lib/types";

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// "● bitacora.es" next to a prefilled field; hover or focus shows the quote it came from.
export function SourceMark({ sources }: { sources?: ImportSuggestion[] }) {
  const first = sources?.[0];
  if (!first) return null;
  return (
    <span className="ob-source" tabIndex={0}>
      <span className="ob-source-dot" aria-hidden="true" />
      {hostOf(first.source_url)}
      <span className="ob-source-pop" role="tooltip">
        <q>{first.source_quote}</q>
        <a href={first.source_url} target="_blank" rel="noreferrer">
          Open page ↗
        </a>
      </span>
    </span>
  );
}

export function Field({
  label,
  hint,
  sources,
  pending = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  sources?: ImportSuggestion[];
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="ob-field">
      <div className="ob-field-head">
        <span className="ob-label">{label}</span>
        {pending ? <span className="ob-pending">Researching…</span> : <SourceMark sources={sources} />}
      </div>
      {hint ? <p className="ob-hint">{hint}</p> : null}
      {children}
    </div>
  );
}

export function Chip({
  selected,
  found = false,
  onClick,
  children,
}: {
  selected: boolean;
  found?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={selected ? "ob-chip ob-chip-on" : "ob-chip"} aria-pressed={selected} onClick={onClick}>
      {found ? <span className="ob-source-dot" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

// Free-text tags: Enter or comma adds one; × removes it.
export function TagInput({
  values,
  onChange,
  placeholder,
  found = [],
  mono = false,
  transform = (value: string) => value,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  found?: string[];
  mono?: boolean;
  transform?: (value: string) => string;
}) {
  const [text, setText] = useState("");
  function add(raw: string) {
    const items = raw
      .split(",")
      .map((item) => transform(item.trim()))
      .filter(Boolean);
    if (items.length) onChange([...new Set([...values, ...items])]);
    setText("");
  }
  return (
    <div className="ob-tags" data-enter-ignore>
      {values.map((value) => (
        <span key={value} className={mono ? "ob-tag mono" : "ob-tag"}>
          {found.includes(value) ? <span className="ob-source-dot" aria-hidden="true" /> : null}
          {value}
          <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}>
            ×
          </button>
        </span>
      ))}
      <input
        className={mono ? "mono" : undefined}
        value={text}
        placeholder={values.length ? "Add more…" : placeholder}
        onChange={(event) => {
          if (event.target.value.includes(",")) add(event.target.value);
          else setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(text);
          } else if (event.key === "Backspace" && !text && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => text && add(text)}
      />
    </div>
  );
}

export function ToggleCard({
  selected,
  title,
  hint,
  found = false,
  onClick,
  children,
}: {
  selected: boolean;
  title: string;
  hint: string;
  found?: boolean;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={selected ? "ob-card ob-card-on" : "ob-card"}>
      <button type="button" className="ob-card-main" aria-pressed={selected} onClick={onClick}>
        <span className="ob-card-text">
          <span className="ob-card-title">
            {found ? <span className="ob-source-dot" aria-hidden="true" /> : null}
            {title}
          </span>
          <span className="ob-card-hint">{hint}</span>
        </span>
        <span className="ob-check" aria-hidden="true">
          {selected ? "✓" : ""}
        </span>
      </button>
      {selected && children ? <div className="ob-card-extra">{children}</div> : null}
    </div>
  );
}

export function OptionRows<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; title: string; hint: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  const name = useId();
  return (
    <div className="ob-options" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className={value === option.value ? "ob-option ob-option-on" : "ob-option"}>
          <input type="radio" name={name} checked={value === option.value} onChange={() => onChange(option.value)} />
          <span className="ob-radio" aria-hidden="true" />
          <span className="ob-option-text">
            <span>{option.title}</span>
            <small>{option.hint}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="ob-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={value === option.value ? "ob-seg ob-seg-on" : "ob-seg"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="ob-switch-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={checked ? "ob-switch ob-switch-on" : "ob-switch"}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}

const COMPACT = new Intl.NumberFormat("en-IE", { notation: "compact", maximumFractionDigits: 2 });

// € amount typed with Spanish grouping (1.250.000); shows "≈ €1.25M" beside it.
export function MoneyInput({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="ob-money">
      <span aria-hidden="true">€</span>
      <input
        aria-label={label}
        inputMode="numeric"
        className="mono"
        placeholder={placeholder}
        value={formatEuros(value)}
        onChange={(event) => onChange(parseEuros(event.target.value))}
      />
      {value ? <small>≈ €{COMPACT.format(value)}</small> : null}
    </div>
  );
}
