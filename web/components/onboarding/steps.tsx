"use client";

import { useState } from "react";
import { CERTIFICATIONS, CPV_OPTIONS, REGIONS } from "@/lib/catalog";
import type { Sources } from "@/lib/onboarding";
import { ENS_LEVELS, isEnsLevel } from "@/lib/profile";
import type { ClassificationStatus, CompanyProfile, ImportSuggestion, RoleceStatus } from "@/lib/types";
import { Chip, Field, MoneyInput, OptionRows, Segmented, Switch, TagInput, ToggleCard } from "./controls";

export type StepProps = {
  draft: CompanyProfile;
  set: <K extends keyof CompanyProfile>(field: K, value: CompanyProfile[K]) => void;
  sources: Sources;
  researching: boolean;
  review: ImportSuggestion[];
  onUseSuggestion: (suggestion: ImportSuggestion) => void;
};

const found = (sources: Sources, field: keyof CompanyProfile) =>
  (sources[field] ?? []).flatMap((item) => (item.values.length ? item.values : [item.value_text]));

// Things research found but didn't fill in (conflicts, unchecked quotes, fields you'd already typed).
function AlsoFound({
  review,
  fields,
  onUse,
}: {
  review: ImportSuggestion[];
  fields: Array<ImportSuggestion["field"]>;
  onUse: (suggestion: ImportSuggestion) => void;
}) {
  const items = review.filter((item) => fields.includes(item.field));
  if (!items.length) return null;
  return (
    <div className="ob-also">
      <span className="ob-label">Also found on your site</span>
      {items.map((item, index) => (
        <div className="ob-also-row" key={index}>
          <span className="ob-also-value">
            {item.values.length ? item.values.join(", ") : item.value_text}
            <small>
              {item.explanation || (item.verified ? "" : "We couldn't double-check this one.")}
            </small>
          </span>
          <button type="button" className="link-button link-strong" onClick={() => onUse(item)}>
            Use
          </button>
        </div>
      ))}
    </div>
  );
}

export function WhatStep({ draft, set, sources, researching, review, onUseSuggestion }: StepProps) {
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [allSectors, setAllSectors] = useState(false);
  const cpvFound = found(sources, "cpv_prefixes");
  const known = new Set(CPV_OPTIONS.map((option) => option.value));
  const extraCodes = draft.cpv_prefixes.filter((code) => !known.has(code));
  const toggleCode = (code: string) =>
    set(
      "cpv_prefixes",
      draft.cpv_prefixes.includes(code) ? draft.cpv_prefixes.filter((item) => item !== code) : [...draft.cpv_prefixes, code],
    );

  return (
    <>
      <div className="ob-identity">
        {editingIdentity ? (
          <div className="ob-identity-edit">
            <input aria-label="Legal name" value={draft.name} onChange={(event) => set("name", event.target.value)} />
            <input
              aria-label="NIF"
              className="mono"
              placeholder="NIF, e.g. B12345678"
              value={draft.nif}
              onChange={(event) => set("nif", event.target.value.toUpperCase())}
            />
          </div>
        ) : (
          <span>
            {draft.name}
            {draft.nif ? <span className="mono"> · {draft.nif}</span> : null}
            <SourceDot sources={sources.name ?? sources.nif} />
          </span>
        )}
        <button type="button" className="link-button" onClick={() => setEditingIdentity(!editingIdentity)}>
          {editingIdentity ? "Done" : "Edit"}
        </button>
      </div>

      <Field
        label="Describe your work in a few sentences"
        hint="We compare this with every tender, so write it the way a buyer would describe the job."
        sources={sources.description}
        pending={researching && !draft.description}
      >
        <textarea
          className="ob-textarea"
          rows={4}
          placeholder="We build and maintain web portals and management software for town halls and regional governments."
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </Field>

      <Field
        label="Sectors"
        hint="Buyers tag every tender with these category numbers (CPV)."
        sources={sources.cpv_prefixes}
        pending={researching && !draft.cpv_prefixes.length}
      >
        <div className="ob-chips">
          {/* With sectors already chosen, show just those until the user asks for the rest. */}
          {CPV_OPTIONS.filter((option) => allSectors || !draft.cpv_prefixes.length || draft.cpv_prefixes.includes(option.value)).map((option) => (
            <Chip
              key={option.value}
              selected={draft.cpv_prefixes.includes(option.value)}
              found={cpvFound.includes(option.value)}
              onClick={() => toggleCode(option.value)}
            >
              {option.label.split(" — ")[1]} <span className="ob-code">{option.value}</span>
            </Chip>
          ))}
          {extraCodes.map((code) => (
            <Chip key={code} selected found={cpvFound.includes(code)} onClick={() => toggleCode(code)}>
              <span className="ob-code">{code}</span>
            </Chip>
          ))}
          {draft.cpv_prefixes.length && !allSectors ? (
            <button type="button" className="ob-chip ob-chip-add" onClick={() => setAllSectors(true)}>
              + Add sectors
            </button>
          ) : null}
        </div>
      </Field>

      <Field
        label="Words buyers would use"
        hint="We look for these in tender titles. Spanish works best."
        sources={sources.keywords}
        pending={researching && !draft.keywords.length}
      >
        <TagInput
          values={draft.keywords}
          found={found(sources, "keywords")}
          onChange={(values) => set("keywords", values)}
          placeholder="portal web, gestión documental, mantenimiento…"
        />
      </Field>

      <AlsoFound
        review={review}
        fields={["name", "nif", "description", "cpv_prefixes", "keywords"]}
        onUse={onUseSuggestion}
      />
    </>
  );
}

function SourceDot({ sources }: { sources?: ImportSuggestion[] }) {
  return sources?.length ? <span className="ob-source-dot ob-inline-dot" title="Found on your site" /> : null;
}

const SIZE_PRESETS: Array<{ label: string; range: [number | null, number | null] }> = [
  { label: "Under €15k", range: [null, 15_000] },
  { label: "€15k – €100k", range: [15_000, 100_000] },
  { label: "€100k – €1M", range: [100_000, 1_000_000] },
  { label: "Over €1M", range: [1_000_000, null] },
  { label: "Any size", range: [null, null] },
];

export function WhereStep({ draft, set, sources, review, onUseSuggestion }: StepProps) {
  const anywhere = draft.regions.length === 0;
  const regionFound = found(sources, "regions");
  const [showRegions, setShowRegions] = useState(!anywhere);

  return (
    <>
      <Field label="Regions" sources={sources.regions}>
        <Switch
          label="Anywhere in Spain"
          checked={anywhere && !showRegions}
          onChange={(checked) => {
            setShowRegions(!checked);
            if (checked) set("regions", []);
          }}
        />
        {showRegions || !anywhere ? (
          <div className="ob-chips ob-reveal">
            {REGIONS.map((region) => (
              <Chip
                key={region.value}
                selected={draft.regions.includes(region.value)}
                found={regionFound.includes(region.value)}
                onClick={() =>
                  set(
                    "regions",
                    draft.regions.includes(region.value)
                      ? draft.regions.filter((item) => item !== region.value)
                      : [...draft.regions, region.value],
                  )
                }
              >
                {region.label}
              </Chip>
            ))}
          </div>
        ) : null}
        {!anywhere ? (
          <Switch
            label="Also show nationwide contracts"
            checked={draft.include_national}
            onChange={(checked) => set("include_national", checked)}
          />
        ) : null}
      </Field>

      <Field label="Contract size" hint="Tenders outside this range are hidden from your feed.">
        <div className="ob-chips">
          {SIZE_PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              selected={draft.min_budget === preset.range[0] && draft.max_budget === preset.range[1]}
              onClick={() => {
                set("min_budget", preset.range[0]);
                set("max_budget", preset.range[1]);
              }}
            >
              {preset.label}
            </Chip>
          ))}
        </div>
        <div className="ob-range">
          <MoneyInput label="Smallest contract" placeholder="No minimum" value={draft.min_budget} onChange={(value) => set("min_budget", value)} />
          <span>to</span>
          <MoneyInput label="Largest contract" placeholder="No limit" value={draft.max_budget} onChange={(value) => set("max_budget", value)} />
        </div>
      </Field>

      <AlsoFound review={review} fields={["regions"]} onUse={onUseSuggestion} />
    </>
  );
}

export function FinancesStep({ draft, set }: StepProps) {
  return (
    <>
      <Field
        label="Best yearly revenue, last three years"
        hint="Excluding VAT. Buyers usually ask for 1.5× a contract's yearly value, so this decides which tenders you can enter."
      >
        <MoneyInput
          label="Best yearly revenue"
          placeholder="1.250.000"
          value={draft.annual_turnover}
          onChange={(value) => set("annual_turnover", value)}
        />
      </Field>
      <Field label="People on the team" hint="Some tenders score team size or ask for SMEs.">
        <input
          className="ob-input mono"
          inputMode="numeric"
          placeholder="25"
          value={draft.employees ?? ""}
          onChange={(event) => {
            const digits = event.target.value.replace(/[^\d]/g, "");
            set("employees", digits ? Number(digits) : null);
          }}
        />
      </Field>
    </>
  );
}

const ROLECE: ReadonlyArray<{ value: RoleceStatus; title: string; hint: string }> = [
  { value: "active", title: "Registered", hint: "We have an active entry" },
  { value: "applied", title: "Applied", hint: "Our application is being processed" },
  { value: "not_registered", title: "Not registered", hint: "We'd send company papers with each bid" },
  { value: "unknown", title: "Not sure", hint: "We'll remind you to check" },
];

const CLASSIFICATION: ReadonlyArray<{ value: ClassificationStatus; label: string }> = [
  { value: "active", label: "Yes" },
  { value: "not_held", label: "No" },
  { value: "unknown", label: "Not sure" },
];

export function RegistrationsStep({ draft, set }: StepProps) {
  return (
    <>
      <Field label="ROLECE status">
        <OptionRows
          label="ROLECE status"
          value={draft.rolece_status === "needs_update" ? "unknown" : draft.rolece_status}
          options={ROLECE}
          onChange={(value) => {
            set("rolece_status", value);
            if (value === "active") set("rolece_last_verified_at", new Date().toISOString());
          }}
        />
      </Field>

      <Field
        label="Business classification"
        hint="An official rating of the kind and size of work you can take on. Larger contracts sometimes ask for it."
      >
        <Segmented
          label="Business classification"
          value={draft.classification_status === "needs_update" ? "active" : draft.classification_status}
          options={CLASSIFICATION}
          onChange={(value) => set("classification_status", value)}
        />
        {draft.classification_status === "active" ? (
          <div className="ob-reveal">
            <TagInput
              mono
              values={draft.classification_codes}
              onChange={(values) => set("classification_codes", values)}
              placeholder="Codes, e.g. V-2-3"
              transform={(value) => value.toUpperCase()}
            />
          </div>
        ) : null}
      </Field>
    </>
  );
}

const ENS_NAMES: Record<string, string> = { ENS_BASICA: "Basic", ENS_MEDIA: "Medium", ENS_ALTA: "High" };

export function CertificationsStep({ draft, set, sources, review, onUseSuggestion }: StepProps) {
  const [more, setMore] = useState(false);
  const certFound = found(sources, "certifications");
  const ens = draft.certifications.find(isEnsLevel);
  const has = (value: string) => draft.certifications.includes(value);
  const toggle = (value: string) =>
    set("certifications", has(value) ? draft.certifications.filter((item) => item !== value) : [...draft.certifications, value]);
  const others = CERTIFICATIONS.filter((option) => !isEnsLevel(option.value) && !["ISO27001", "ISO9001"].includes(option.value));
  const otherHeld = others.filter((option) => has(option.value));

  return (
    <>
      <div className="ob-cards">
        <ToggleCard
          title="ISO/IEC 27001"
          hint="Information security"
          selected={has("ISO27001")}
          found={certFound.includes("ISO27001")}
          onClick={() => toggle("ISO27001")}
        />
        <ToggleCard
          title="ISO 9001"
          hint="Quality management"
          selected={has("ISO9001")}
          found={certFound.includes("ISO9001")}
          onClick={() => toggle("ISO9001")}
        />
        <ToggleCard
          title="ENS"
          hint="Spain's security standard for public systems"
          selected={Boolean(ens)}
          found={certFound.some(isEnsLevel)}
          onClick={() =>
            set(
              "certifications",
              ens ? draft.certifications.filter((item) => !isEnsLevel(item)) : [...draft.certifications, "ENS_MEDIA"],
            )
          }
        >
          <Segmented
            label="ENS category"
            value={ens ?? "ENS_MEDIA"}
            options={ENS_LEVELS.map((level) => ({ value: level, label: ENS_NAMES[level] }))}
            onChange={(level) => set("certifications", [...draft.certifications.filter((item) => !isEnsLevel(item)), level])}
          />
        </ToggleCard>
      </div>

      {more || otherHeld.length ? (
        <Field label="Other certificates">
          <div className="ob-chips ob-reveal">
            {others.map((option) => (
              <Chip key={option.value} selected={has(option.value)} found={certFound.includes(option.value)} onClick={() => toggle(option.value)}>
                {option.label}
              </Chip>
            ))}
          </div>
        </Field>
      ) : (
        <button type="button" className="link-button ob-more" onClick={() => setMore(true)}>
          + Other certificates (ISO 14001, ISO 20000, CMMI…)
        </button>
      )}

      <AlsoFound review={review} fields={["certifications"]} onUse={onUseSuggestion} />
    </>
  );
}
