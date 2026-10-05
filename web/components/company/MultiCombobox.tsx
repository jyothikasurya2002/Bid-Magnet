"use client";

import { useId, useMemo, useRef, useState } from "react";
import type { CatalogueOption } from "@/lib/catalog";

type MultiComboboxProps = {
  label: string;
  options: CatalogueOption[];
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
  hint?: string;
  emptyMessage?: string;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function MultiCombobox({
  label,
  options,
  values,
  onChange,
  placeholder,
  hint,
  emptyMessage = "No matches found. Try another term.",
}: MultiComboboxProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const selected = options.filter((option) => values.includes(option.value));
  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    return options
      .filter((option) => !values.includes(option.value))
      .filter((option) => {
        if (!needle) return true;
        return normalize(
          `${option.value} ${option.label} ${option.description ?? ""} ${option.group ?? ""}`,
        ).includes(needle);
      })
      .slice(0, 10);
  }, [options, query, values]);

  function select(option: CatalogueOption) {
    onChange([...values, option.value]);
    setAnnouncement(`${option.label} added. ${values.length + 1} selected.`);
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
    inputRef.current?.focus();
  }

  function remove(option: CatalogueOption) {
    onChange(values.filter((value) => value !== option.value));
    setAnnouncement(`${option.label} removed. ${values.length - 1} selected.`);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      select(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Backspace" && !query && selected.length) {
      event.preventDefault();
      remove(selected[selected.length - 1]);
    }
  }

  return (
    <div className="field field-full">
      <label id={`${id}-label`} htmlFor={`${id}-input`}>
        {label}
      </label>
      {hint ? <p className="field-hint">{hint}</p> : null}
      <div className="combobox">
        <div className="combobox-control">
          {selected.map((option) => (
            <span className="chip" key={option.value}>
              <span>{option.label}</span>
              <button
                type="button"
                onClick={() => remove(option)}
                aria-label={`Remove ${option.label}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={`${id}-input`}
            role="combobox"
            aria-labelledby={`${id}-label`}
            aria-expanded={open}
            aria-controls={`${id}-listbox`}
            aria-autocomplete="list"
            aria-activedescendant={
              open && filtered[activeIndex]
                ? `${id}-option-${filtered[activeIndex].value}`
                : undefined
            }
            value={query}
            placeholder={values.length ? "" : placeholder}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>

        {open ? (
          <div
            id={`${id}-listbox`}
            className="combobox-menu"
            role="listbox"
            aria-multiselectable="true"
          >
            {filtered.length ? (
              filtered.map((option, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={values.includes(option.value)}
                  id={`${id}-option-${option.value}`}
                  key={option.value}
                  className={`combobox-option ${
                    index === activeIndex ? "combobox-option-active" : ""
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => select(option)}
                >
                  <strong>{option.label}</strong>
                  {option.description ? <small>{option.description}</small> : null}
                </button>
              ))
            ) : (
              <div className="combobox-empty">{emptyMessage}</div>
            )}
          </div>
        ) : null}
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
