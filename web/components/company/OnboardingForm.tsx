"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CERTIFICATIONS, CPV_OPTIONS, REGIONS } from "@/lib/catalog";
import {
  applyDocumentExtraction,
  applyImportSuggestion,
  companyWritePayload,
  validateCompanyProfile,
} from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import type {
  CompanyProfile,
  DocumentExtraction,
  ImportResult,
  ImportSuggestion,
  RoleceStatus,
} from "@/lib/types";
import { DocumentUploader } from "./DocumentUploader";
import { MultiCombobox } from "./MultiCombobox";

type OnboardingFormProps = {
  initialCompany: CompanyProfile;
  userId: string;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const FIELD_LABELS: Record<ImportSuggestion["field"], string> = {
  name: "Company name",
  nif: "NIF",
  description: "Company description",
  website_url: "Website",
  keywords: "Services and keywords",
  cpv_prefixes: "Suggested CPV codes",
  regions: "Locations found",
  certifications: "Credentials mentioned",
};

export function OnboardingForm({ initialCompany, userId }: OnboardingFormProps) {
  const router = useRouter();
  const errorRef = useRef<HTMLDivElement>(null);
  const [company, setCompany] = useState(initialCompany);
  const [savedCompany, setSavedCompany] = useState(initialCompany);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [websiteInput, setWebsiteInput] = useState(initialCompany.website_url);
  const [importState, setImportState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [resolvedSuggestions, setResolvedSuggestions] = useState<Set<number>>(new Set());

  const dirty = useMemo(
    () => JSON.stringify(company) !== JSON.stringify(savedCompany),
    [company, savedCompany],
  );

  useEffect(() => {
    if (!company.id || !dirty || !company.name.trim()) return;
    const timer = window.setTimeout(() => void save(false), 1_400);
    return () => window.clearTimeout(timer);
    // save intentionally uses the latest company snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, dirty]);

  function update<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) {
    setCompany((current) => ({ ...current, [key]: value }));
    setSaveState("dirty");
  }

  async function save(goToMatches: boolean) {
    const errors = validateCompanyProfile(company);
    if (errors.length) {
      setSaveError(errors.join(" "));
      setSaveState("error");
      window.setTimeout(() => errorRef.current?.focus(), 0);
      return;
    }

    setSaveState("saving");
    setSaveError("");
    const supabase = createClient();
    const now = new Date().toISOString();
    const payload = companyWritePayload(company, now);

    const query = company.id
      ? supabase.from("companies").update(payload).eq("id", company.id)
      : supabase.from("companies").insert(payload);
    const { data, error } = await query.select("*").single();

    if (error || !data) {
      setSaveError(
        error?.message ||
          "The profile could not be saved. Your changes are still on this page.",
      );
      setSaveState("error");
      return;
    }

    const saved = { ...company, ...data } as CompanyProfile;
    setCompany(saved);
    setSavedCompany(saved);
    setSaveState("saved");

    if (goToMatches) {
      router.push(`/discover?company=${saved.id}&onboarded=1`);
    } else {
      window.setTimeout(() => setSaveState("idle"), 2_000);
    }
  }

  async function importWebsite() {
    if (!websiteInput.trim()) {
      setImportError("Enter your company website.");
      setImportState("error");
      return;
    }
    setImportState("loading");
    setImportError("");
    setImportResult(null);
    setResolvedSuggestions(new Set());

    try {
      const response = await fetch("/api/company/import-website", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: websiteInput }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Website import failed.");
      setImportResult(result);
      setImportState("ready");
      update("website_url", result.canonical_url);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Website import failed. Try again.",
      );
      setImportState("error");
    }
  }

  function applySuggestion(suggestion: ImportSuggestion, index: number) {
    setCompany((current) => applyImportSuggestion(current, suggestion));
    setSaveState("dirty");
    setResolvedSuggestions((current) => new Set(current).add(index));
  }

  function acceptExtraction(extraction: DocumentExtraction) {
    setCompany((current) => applyDocumentExtraction(current, extraction));
    setSaveState("dirty");
  }

  const taskState = {
    essentials: Boolean(company.name && company.description),
    services: Boolean(company.cpv_prefixes.length || company.keywords.length),
    geography: Boolean(company.include_national || company.regions.length),
    readiness: company.rolece_status !== "unknown",
    credentials: Boolean(company.certifications.length),
  };
  const completedTasks = Object.values(taskState).filter(Boolean).length;

  return (
    <>
      <div className="onboarding-grid">
        <div className="main-column">
          <section className="import-panel" aria-labelledby="website-import-title">
            <div className="import-intro">
              <div className="field">
                <label id="website-import-title" htmlFor="website-import">
                  Prefill from your website <span className="optional">(optional)</span>
                </label>
                <p className="field-hint">
                  Add your website and Copilot can prefill the basics. Nothing changes
                  until you review it.
                </p>
                <input
                  id="website-import"
                  type="url"
                  inputMode="url"
                  placeholder="https://yourcompany.es"
                  value={websiteInput}
                  onChange={(event) => setWebsiteInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void importWebsite();
                    }
                  }}
                />
              </div>
              <button
                type="button"
                className="button button-secondary"
                disabled={importState === "loading"}
                onClick={() => void importWebsite()}
              >
                {importState === "loading" ? "Checking…" : "Prefill details"}
              </button>
            </div>

            {importState === "loading" ? (
              <div className="import-progress" role="status">
                <span className="spinner" aria-hidden="true" />
                Checking the website, reading selected pages and reviewing what we found…
              </div>
            ) : null}
            {importError ? (
              <div className="notice notice-error" role="alert">
                {importError}
              </div>
            ) : null}

            {importResult ? (
              <>
                <div className="proposal-list">
                  {importResult.suggestions.map((suggestion, index) => {
                    const resolved = resolvedSuggestions.has(index);
                    const badge =
                      suggestion.evidence_state === "conflict"
                        ? "Conflict"
                        : suggestion.evidence_state === "direct_source"
                          ? "From website"
                          : "Needs review";
                    return (
                      <article className="proposal" key={`${suggestion.field}-${index}`}>
                        <span className="proposal-field">{FIELD_LABELS[suggestion.field]}</span>
                        <div className="proposal-value">
                          <span
                            className={`badge ${
                              resolved
                                ? "badge-success"
                                : suggestion.evidence_state === "conflict"
                                  ? "badge-warning"
                                  : ""
                            }`}
                          >
                            {resolved ? "Selected" : badge}
                          </span>
                          <strong>
                            {suggestion.values.length
                              ? suggestion.values.join(", ")
                              : suggestion.value_text}
                          </strong>
                          <p>{suggestion.explanation}</p>
                          <details className="source-details">
                            <summary>View source</summary>
                            <blockquote>“{suggestion.source_quote}”</blockquote>
                            <a href={suggestion.source_url} target="_blank" rel="noreferrer">
                              Open original
                            </a>
                          </details>
                        </div>
                        <div className="proposal-actions">
                          {!resolved ? (
                            <>
                              <button
                                type="button"
                                className="button button-quiet button-small"
                                onClick={() => applySuggestion(suggestion, index)}
                              >
                                Use
                              </button>
                              <button
                                type="button"
                                className="button button-secondary button-small"
                                onClick={() =>
                                  setResolvedSuggestions((current) =>
                                    new Set(current).add(index),
                                  )
                                }
                              >
                                Skip
                              </button>
                            </>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
                <details className="source-details" style={{ padding: "0 24px 18px" }}>
                  <summary>Pages checked</summary>
                  <ul className="task-list">
                    {importResult.checked_pages.map((page) => (
                      <li className="task-item" key={page.url}>
                        <span>{page.title}</span>
                        <span
                          className={`task-status ${
                            page.status === "read" ? "task-status-complete" : ""
                          }`}
                        >
                          {page.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : null}
          </section>

          {saveError ? (
            <div
              ref={errorRef}
              className="notice notice-error"
              role="alert"
              tabIndex={-1}
            >
              <strong>Check the company profile</strong>
              <span>{saveError}</span>
            </div>
          ) : null}

          <section className="section-card" aria-labelledby="essentials-title">
            <div className="section-heading">
              <div>
                <h2 id="essentials-title">Company essentials</h2>
                <p>The legal and financial facts used across every tender.</p>
              </div>
              <span className="step-label">01</span>
            </div>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="company-name">Legal company name</label>
                <input
                  id="company-name"
                  autoComplete="organization"
                  value={company.name}
                  onChange={(event) => update("name", event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="nif">NIF <span className="optional">(optional)</span></label>
                <input
                  id="nif"
                  className="mono"
                  placeholder="B12345678"
                  value={company.nif}
                  onChange={(event) => update("nif", event.target.value.toUpperCase())}
                />
              </div>
              <div className="field field-full">
                <label htmlFor="description">What does your company do?</label>
                <p className="field-hint">
                  This description powers meaning-based matching from the next daily refresh.
                </p>
                <textarea
                  id="description"
                  placeholder="We build and maintain municipal web applications, cloud platforms and citizen services."
                  value={company.description}
                  onChange={(event) => update("description", event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="employees">Employees <span className="optional">(optional)</span></label>
                <input
                  id="employees"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={company.employees ?? ""}
                  onChange={(event) =>
                    update("employees", event.target.value ? Number(event.target.value) : null)
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="turnover">Best annual turnover, last 3 years</label>
                <div className="input-prefix">
                  <span>€</span>
                  <input
                    id="turnover"
                    type="number"
                    min={0}
                    step={1000}
                    inputMode="numeric"
                    value={company.annual_turnover ?? ""}
                    onChange={(event) =>
                      update(
                        "annual_turnover",
                        event.target.value ? Number(event.target.value) : null,
                      )
                    }
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="section-card" aria-labelledby="services-title">
            <div className="section-heading">
              <div>
                <h2 id="services-title">Services and tender preferences</h2>
                <p>Tell Copilot what work to find and where you can deliver it.</p>
              </div>
              <span className="step-label">02</span>
            </div>
            <div className="form-grid">
              <MultiCombobox
                label="IT services and CPV areas"
                options={CPV_OPTIONS}
                values={company.cpv_prefixes}
                onChange={(values) => update("cpv_prefixes", values)}
                placeholder="Search software, cloud, support…"
                hint="Choose broad areas now; you can refine them later."
                emptyMessage="No CPV matches that term. Try software, cloud, support or hardware."
              />
              <div className="field field-full">
                <label htmlFor="keywords">Service keywords <span className="optional">(optional)</span></label>
                <p className="field-hint">Comma-separated terms that buyers use in tender titles.</p>
                <input
                  id="keywords"
                  placeholder="municipal software, cloud, portals, maintenance"
                  value={company.keywords.join(", ")}
                  onChange={(event) =>
                    update(
                      "keywords",
                      event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </div>
              <MultiCombobox
                label="Regions"
                options={REGIONS}
                values={company.regions}
                onChange={(values) => update("regions", values)}
                placeholder="Search autonomous communities…"
                hint="Leave empty if you work anywhere in Spain."
              />
              <div className="field field-full">
                <label>
                  <input
                    type="checkbox"
                    style={{ width: 16, minHeight: 16, marginRight: 8 }}
                    checked={company.include_national}
                    onChange={(event) => update("include_national", event.target.checked)}
                  />
                  Include nationwide contracts
                </label>
              </div>
              <div className="field">
                <label htmlFor="min-budget">Minimum contract budget <span className="optional">(optional)</span></label>
                <div className="input-prefix">
                  <span>€</span>
                  <input
                    id="min-budget"
                    type="number"
                    min={0}
                    step={1000}
                    value={company.min_budget ?? ""}
                    onChange={(event) =>
                      update("min_budget", event.target.value ? Number(event.target.value) : null)
                    }
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="max-budget">Maximum contract budget <span className="optional">(optional)</span></label>
                <div className="input-prefix">
                  <span>€</span>
                  <input
                    id="max-budget"
                    type="number"
                    min={0}
                    step={1000}
                    value={company.max_budget ?? ""}
                    onChange={(event) =>
                      update("max_budget", event.target.value ? Number(event.target.value) : null)
                    }
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="section-card" aria-labelledby="readiness-title">
            <div className="section-heading">
              <div>
                <h2 id="readiness-title">Certifications & procurement readiness</h2>
                <p>Reusable evidence that determines whether you can bid.</p>
              </div>
              <span className="step-label">03</span>
            </div>
            <div className="form-grid">
              <div className="field field-full">
                <span className="field-label">ROLECE status</span>
                <p className="field-hint">
                  Spain&apos;s official bidder registry. Many simplified tenders require
                  active registration or a submitted application.
                </p>
                <div className="segmented">
                  {[
                    ["active", "Registered"],
                    ["applied", "Applied"],
                    ["not_registered", "Not registered"],
                    ["unknown", "Unknown"],
                  ].map(([value, label]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="rolece"
                        value={value}
                        checked={company.rolece_status === value}
                        onChange={() => update("rolece_status", value as RoleceStatus)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="classification-status">Business classification</label>
                <select
                  id="classification-status"
                  value={company.classification_status}
                  onChange={(event) =>
                    update(
                      "classification_status",
                      event.target.value as CompanyProfile["classification_status"],
                    )
                  }
                >
                  <option value="unknown">Unknown</option>
                  <option value="active">Active</option>
                  <option value="not_held">Not held</option>
                  <option value="needs_update">Needs update</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="classification-codes">Classification codes <span className="optional">(optional)</span></label>
                <input
                  id="classification-codes"
                  className="mono"
                  placeholder="V-2-3, V-5-2"
                  value={company.classification_codes.join(", ")}
                  onChange={(event) =>
                    update(
                      "classification_codes",
                      event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </div>
              <MultiCombobox
                label="Certifications and attestations"
                options={CERTIFICATIONS}
                values={company.certifications}
                onChange={(values) => update("certifications", values)}
                placeholder="Search ENS, ISO, CMMI…"
                hint="Choose only credentials currently held by this legal entity."
              />
            </div>

            <details style={{ marginTop: 22 }}>
              <summary className="button button-secondary button-small">
                Improve eligibility accuracy with evidence
              </summary>
              <div style={{ marginTop: 14 }}>
                <DocumentUploader
                  companyId={company.id}
                  userId={userId}
                  onAcceptExtraction={acceptExtraction}
                />
              </div>
            </details>
          </section>
        </div>

        <aside className="rail" aria-label="Profile readiness">
          <section className="rail-card">
            <div className="rail-heading">
              <div>
                <p className="eyebrow">Copilot</p>
                <h2>Profile readiness</h2>
                <p>Complete the essentials, then improve evidence over time.</p>
              </div>
            </div>
            <div className="rail-metric">
              <span className="metric-number">{completedTasks}/5</span>
              <span className="metric-copy">
                <strong>Areas ready</strong>
                <span>Not part of your fit score</span>
              </span>
            </div>
            <ul className="task-list">
              {[
                ["Company essentials", taskState.essentials],
                ["Services", taskState.services],
                ["Geography", taskState.geography],
                ["ROLECE status", taskState.readiness],
                ["Credentials", taskState.credentials],
              ].map(([label, complete]) => (
                <li className="task-item" key={String(label)}>
                  <span>{label}</span>
                  <span
                    className={`task-status ${complete ? "task-status-complete" : ""}`}
                  >
                    {complete ? "Ready" : "Needs input"}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rail-card">
            <p className="eyebrow">What changes next</p>
            <p style={{ margin: "8px 0 0", color: "var(--text-secondary)" }}>
              CPV, keywords and regions improve your feed immediately. Meaning-based
              matching refreshes with the next daily backend run.
            </p>
          </section>
        </aside>
      </div>

      <div className="save-bar">
        <div className="save-bar-inner">
          <span className="save-status" role="status">
            {saveState === "saving"
              ? "Saving…"
              : saveState === "saved"
                ? `Saved at ${new Date().toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : dirty
                  ? "Unsaved changes"
                  : "Profile is up to date"}
          </span>
          <div className="button-row">
            {dirty && company.id ? (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setCompany(savedCompany)}
              >
                Discard
              </button>
            ) : null}
            <button
              type="button"
              className="button button-primary"
              disabled={saveState === "saving"}
              onClick={() => void save(true)}
            >
              Save and see matches
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
