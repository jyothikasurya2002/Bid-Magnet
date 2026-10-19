"use client";

import { useState, type ReactNode } from "react";
import type { CatalogueOption } from "@/lib/catalog";
import { MultiCombobox } from "./MultiCombobox";

type SaveResult = Promise<boolean>;

type ShellProps = {
  onSave: () => SaveResult;
  onCancel: () => void;
  children: ReactNode;
  error?: string;
};

// Shared Save / Cancel frame. Enter saves (outside textareas), Escape cancels.
function EditorShell({ onSave, onCancel, children, error }: ShellProps) {
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    await onSave();
    setSaving(false);
  }

  return (
    <form
      className="inline-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <div className="inline-editor-body">{children}</div>
      <div className="inline-editor-actions">
        <button type="submit" className="button button-dark button-small" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </form>
  );
}

type BaseProps<T> = {
  label: string;
  initial: T;
  onSave: (value: T) => SaveResult;
  onCancel: () => void;
};

export function TextEditor({
  label,
  initial,
  onSave,
  onCancel,
  multiline = false,
  placeholder,
  mono = false,
  required = false,
  transform = (value: string) => value,
}: BaseProps<string> & {
  multiline?: boolean;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  transform?: (value: string) => string;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const props = {
    "aria-label": label,
    autoFocus: true,
    placeholder,
    value,
    className: mono ? "mono" : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(transform(event.target.value)),
  };
  return (
    <EditorShell
      error={error}
      onCancel={onCancel}
      onSave={() => {
        if (required && !value.trim()) {
          setError(`${label} can't be empty.`);
          return Promise.resolve(false);
        }
        return onSave(value);
      }}
    >
      {multiline ? <textarea rows={4} {...props} /> : <input {...props} />}
    </EditorShell>
  );
}

function parseAmount(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  return digits ? Number(digits) : null;
}

export function NumberEditor({
  label,
  initial,
  onSave,
  onCancel,
  prefix,
  placeholder,
}: BaseProps<number | null> & { prefix?: string; placeholder?: string }) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const input = (
    <input
      aria-label={label}
      autoFocus
      inputMode="numeric"
      className="mono"
      placeholder={placeholder}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
  return (
    <EditorShell onCancel={onCancel} onSave={() => onSave(parseAmount(value))}>
      {prefix ? (
        <div className="input-prefix">
          <span>{prefix}</span>
          {input}
        </div>
      ) : (
        input
      )}
    </EditorShell>
  );
}

export function RangeEditor({
  label,
  initial,
  onSave,
  onCancel,
}: BaseProps<[number | null, number | null]>) {
  const [min, setMin] = useState(initial[0] === null ? "" : String(initial[0]));
  const [max, setMax] = useState(initial[1] === null ? "" : String(initial[1]));
  const [error, setError] = useState("");
  return (
    <EditorShell
      error={error}
      onCancel={onCancel}
      onSave={() => {
        const low = parseAmount(min);
        const high = parseAmount(max);
        if (low !== null && high !== null && low > high) {
          setError("The minimum is above the maximum.");
          return Promise.resolve(false);
        }
        return onSave([low, high]);
      }}
    >
      <div className="range-inputs">
        <div className="input-prefix">
          <span>€</span>
          <input
            aria-label={`${label} minimum`}
            autoFocus
            inputMode="numeric"
            className="mono"
            placeholder="No minimum"
            value={min}
            onChange={(event) => setMin(event.target.value)}
          />
        </div>
        <span aria-hidden="true">–</span>
        <div className="input-prefix">
          <span>€</span>
          <input
            aria-label={`${label} maximum`}
            inputMode="numeric"
            className="mono"
            placeholder="No maximum"
            value={max}
            onChange={(event) => setMax(event.target.value)}
          />
        </div>
      </div>
    </EditorShell>
  );
}

export function ChoiceEditor<T extends string>({
  label,
  initial,
  onSave,
  onCancel,
  options,
}: BaseProps<T> & { options: ReadonlyArray<{ value: T; label: string }> }) {
  const [value, setValue] = useState<T>(initial);
  return (
    <EditorShell onCancel={onCancel} onSave={() => onSave(value)}>
      <div className="choice-row" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <label key={option.value} className="choice">
            <input
              type="radio"
              name={label}
              value={option.value}
              checked={value === option.value}
              onChange={() => setValue(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </EditorShell>
  );
}

export function ChipsEditor({
  label,
  initial,
  onSave,
  onCancel,
  options,
  placeholder,
}: BaseProps<string[]> & { options: CatalogueOption[]; placeholder: string }) {
  const [values, setValues] = useState(initial);
  // Codes saved earlier that are not in the catalogue stay selectable.
  const known = new Set(options.map((option) => option.value));
  const merged = [
    ...options,
    ...initial.filter((value) => !known.has(value)).map((value) => ({ value, label: value })),
  ];
  return (
    <EditorShell onCancel={onCancel} onSave={() => onSave(values)}>
      <MultiCombobox
        label={label}
        options={merged}
        values={values}
        onChange={setValues}
        placeholder={placeholder}
      />
    </EditorShell>
  );
}

export function ListEditor({
  label,
  initial,
  onSave,
  onCancel,
  placeholder,
  mono = false,
}: BaseProps<string[]> & { placeholder: string; mono?: boolean }) {
  const [value, setValue] = useState(initial.join(", "));
  return (
    <EditorShell
      onCancel={onCancel}
      onSave={() =>
        onSave([
          ...new Set(
            value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ])
      }
    >
      <input
        aria-label={label}
        autoFocus
        className={mono ? "mono" : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <small className="field-hint">Separate with commas.</small>
    </EditorShell>
  );
}

export function ClassificationEditor({
  initial,
  onSave,
  onCancel,
  options,
}: {
  initial: { status: string; codes: string[] };
  onSave: (value: { status: string; codes: string[] }) => SaveResult;
  onCancel: () => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const [status, setStatus] = useState(initial.status);
  const [codes, setCodes] = useState(initial.codes.join(", "));
  return (
    <EditorShell
      onCancel={onCancel}
      onSave={() =>
        onSave({
          status,
          codes:
            status === "active"
              ? codes
                  .split(",")
                  .map((code) => code.trim().toUpperCase())
                  .filter(Boolean)
              : [],
        })
      }
    >
      <div className="choice-row" role="radiogroup" aria-label="Business classification">
        {options.map((option) => (
          <label key={option.value} className="choice">
            <input
              type="radio"
              name="classification"
              value={option.value}
              checked={status === option.value}
              onChange={() => setStatus(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      {status === "active" ? (
        <input
          aria-label="Classification codes"
          className="mono"
          placeholder="Group-subgroup-category, e.g. V-2-3, V-3-2"
          value={codes}
          onChange={(event) => setCodes(event.target.value)}
        />
      ) : null}
    </EditorShell>
  );
}
