"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CERTIFICATIONS, CPV_OPTIONS, REGIONS, ROLECE_OPTIONS } from "@/lib/catalog";
import {
  certProofKey,
  documentExpiry,
  proofFor,
  validity,
  type ProofKey,
} from "@/lib/evidence";
import type { GapAction } from "@/lib/gaps";
import {
  applyDocumentExtraction,
  applyImportSuggestion,
  companyFromRow,
  companyPatchPayload,
  ENS_LEVELS,
  isEnsLevel,
} from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import type {
  ClassificationStatus,
  CompanyDocument,
  CompanyProfile,
  DocumentExtraction,
  ImportSuggestion,
  RoleceStatus,
} from "@/lib/types";
import { DocumentsPanel } from "./DocumentsPanel";
import {
  ChipsEditor,
  ChoiceEditor,
  ClassificationEditor,
  ListEditor,
  NumberEditor,
  RangeEditor,
  TextEditor,
} from "./editors";
import { DocChip, FactRow, LedgerTable, type Status } from "./FactRow";
import { GapRail } from "./GapRail";
import { RowUpload } from "./RowUpload";
import { useCompanyDocuments } from "./useCompanyDocuments";
import { WebsiteImport } from "./WebsiteImport";

type CompanyLedgerProps = {
  initialCompany: CompanyProfile;
  initialDocuments: CompanyDocument[];
  userId: string;
  importOnLoad?: boolean;
};

const EURO = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

const MISSING: Status = { tone: "warn", label: "Missing" };
const NOT_SET: Status = { tone: "neutral", label: "Not set" };
const SELF_DECLARED: Status = { tone: "neutral", label: "Self-declared" };
const IN_MATCHING: Status = { tone: "good", label: "In matching" };

// Certifications match_tenders checks; everything else is stored for bid prep only.
const CORE_CERTS = [
  { value: "ISO27001", label: "ISO/IEC 27001", hint: "Information security" },
  { value: "ISO9001", label: "ISO 9001", hint: "Quality management" },
];
const ENS_LABELS: Record<string, string> = {
  ENS_BASICA: "Basic category",
  ENS_MEDIA: "Medium category",
  ENS_ALTA: "High category",
};
const ROLECE_VALUES: Record<RoleceStatus, string> = {
  active: "Registered",
  applied: "Application submitted",
  not_registered: "Not registered",
  needs_update: "Needs updating",
  unknown: "Not set",
};
const CLASSIFICATION_OPTIONS: Array<{ value: ClassificationStatus; label: string }> = [
  { value: "active", label: "Held" },
  { value: "not_held", label: "Not held" },
  { value: "needs_update", label: "Needs updating" },
  { value: "unknown", label: "Not sure" },
];

function cpvLabel(code: string) {
  const option = CPV_OPTIONS.find((candidate) => candidate.value === code);
  return option ? option.label.split(" — ")[1] : null;
}

function Tags({ values, render }: { values: string[]; render?: (value: string) => ReactNode }) {
  return (
    <span className="tags">
      {values.map((value) => (
        <span className="tag" key={value}>
          {render ? render(value) : value}
        </span>
      ))}
    </span>
  );
}

export function CompanyLedger({
  initialCompany,
  initialDocuments,
  userId,
  importOnLoad = false,
}: CompanyLedgerProps) {
  const [company, setCompany] = useState(initialCompany);
  const companyRef = useRef(company);
  const [editing, setEditing] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [importUrl, setImportUrl] = useState<string | null>(
    importOnLoad && initialCompany.website_url ? initialCompany.website_url : null,
  );
  const fileInput = useRef<HTMLInputElement>(null);
  // row the file picker was opened from; undefined = general upload
  const pickTarget = useRef<ProofKey | undefined>(undefined);
  const [drag, setDrag] = useState<{ active: boolean; target: ProofKey | null }>({
    active: false,
    target: null,
  });

  useEffect(() => {
    companyRef.current = company;
  }, [company]);

  async function saveFields(patch: Partial<CompanyProfile>) {
    setSaveError("");
    const { data, error } = await createClient()
      .from("companies")
      .update(companyPatchPayload(patch, new Date().toISOString()))
      .eq("id", companyRef.current.id)
      .select("*")
      .single();
    if (error || !data) {
      setSaveError(error?.message || "That change didn't save. Try again.");
      return false;
    }
    const saved = companyFromRow(data);
    companyRef.current = saved;
    setCompany(saved);
    setRevision((value) => value + 1);
    return true;
  }

  async function applyExtraction(extraction: DocumentExtraction) {
    const current = companyRef.current;
    const next = applyDocumentExtraction(current, extraction);
    const keys = [
      "certifications",
      "rolece_status",
      "rolece_last_verified_at",
      "classification_status",
      "classification_codes",
    ] as const;
    const patch: Partial<CompanyProfile> = {};
    for (const key of keys) {
      if (JSON.stringify(next[key]) !== JSON.stringify(current[key])) {
        Object.assign(patch, { [key]: next[key] });
      }
    }
    return Object.keys(patch).length ? saveFields(patch) : true;
  }

  function applySuggestion(suggestion: ImportSuggestion) {
    const next = applyImportSuggestion(companyRef.current, suggestion);
    return saveFields({ [suggestion.field]: next[suggestion.field] });
  }

  const docs = useCompanyDocuments({
    companyId: company.id,
    userId,
    initial: initialDocuments,
    onConfirmed: applyExtraction,
  });

  function pickFiles(target?: ProofKey) {
    pickTarget.current = target;
    fileInput.current?.click();
  }

  // Files can be dropped anywhere: on a proof row they become that row's proof,
  // elsewhere they go to Documents.
  const uploadRef = useRef(docs.upload);
  useEffect(() => {
    uploadRef.current = docs.upload;
  });
  useEffect(() => {
    // dragenter/dragleave fire for every child element; count them to know when the drag leaves the window
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const rowKey = (event: DragEvent) =>
      ((event.target as Element | null)?.closest?.("[data-proof-key]")?.getAttribute("data-proof-key") ??
        null) as ProofKey | null;

    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDrag({ active: true, target: rowKey(event) });
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      const target = rowKey(event);
      setDrag((current) => (current.active && current.target === target ? current : { active: true, target }));
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDrag({ active: false, target: null });
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      const target = rowKey(event);
      setDrag({ active: false, target: null });
      if (event.dataTransfer?.files.length) {
        uploadRef.current(event.dataTransfer.files, target ?? undefined);
        if (!target) document.getElementById("documents")?.scrollIntoView({ behavior: "smooth" });
      }
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  function focusFact(id: string) {
    setEditing(id);
    window.requestAnimationFrame(() =>
      document.getElementById(`fact-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }

  function handleGap(action: GapAction) {
    if (action.kind === "add-region") {
      void saveFields({ regions: [...new Set([...companyRef.current.regions, action.region])] });
    } else {
      focusFact(action.fact);
    }
  }

  // Editors save one fact and close.
  const close = () => setEditing(null);
  const saveAndClose = async (patch: Partial<CompanyProfile>) => {
    const ok = await saveFields(patch);
    if (ok) close();
    return ok;
  };
  const edit = (id: string) => () => setEditing(id);
  const isEditing = (id: string) => editing === id;

  const proof = (key: ProofKey) => proofFor(key, docs.documents);
  // Proof cell: the confirmed document, or an upload button (orange when the fact is claimed without proof).
  const proofCell = (key: ProofKey, document: CompanyDocument | undefined, claimed: boolean, label: string) =>
    document ? (
      <DocChip document={document} onOpen={() => void docs.open(document)} />
    ) : (
      <button
        type="button"
        className={claimed ? "attach-button" : "attach-button attach-button-quiet"}
        onClick={() => pickFiles(key)}
      >
        + Upload<span className="sr-only"> {label} certificate</span>
      </button>
    );

  // Drop target plus the in-row upload progress and review for a proof row.
  const proofRow = (key: ProofKey, label: string) => {
    const pending = docs.uploads.find((item) => item.target === key);
    const document = docs.documents.find(
      (item) => docs.targets[item.id] === key && item.processing_status !== "ready",
    );
    return {
      proofKey: key,
      dropActive: drag.active && drag.target === key,
      below:
        pending || document ? (
          <RowUpload
            proofKey={key}
            label={label}
            upload={pending}
            document={pending ? undefined : document}
            error={document ? docs.errors[document.id] : undefined}
            companyNif={company.nif}
            onConfirm={(item) => void docs.confirm(item)}
            onReject={(item) => void docs.reject(item)}
            onRetry={(item) => void docs.retry(item)}
            onOpen={(item) => void docs.open(item)}
            onDismiss={() =>
              pending ? docs.dismissUpload(pending.localId) : document && docs.dismissTarget(document.id)
            }
          />
        ) : undefined,
    };
  };

  const hasMatchingInput = company.cpv_prefixes.length > 0 || company.keywords.length > 0;
  const ensLevel = company.certifications.find(isEnsLevel);
  const otherCerts = company.certifications.filter(
    (value) => !isEnsLevel(value) && !CORE_CERTS.some((core) => core.value === value),
  );
  const addableCerts = CERTIFICATIONS.filter(
    (option) =>
      !isEnsLevel(option.value) &&
      !CORE_CERTS.some((core) => core.value === option.value) &&
      !company.certifications.includes(option.value),
  );

  const roleceProof = proof("rolece");
  const roleceStatus: Status =
    company.rolece_status === "active"
      ? roleceProof
        ? validity(documentExpiry(roleceProof.extraction))
        : SELF_DECLARED
      : company.rolece_status === "applied"
        ? { tone: "warn", label: "Pending" }
        : company.rolece_status === "not_registered"
          ? { tone: "warn", label: "Not registered" }
          : company.rolece_status === "needs_update"
            ? { tone: "warn", label: "Needs update" }
            : MISSING;

  const classificationProof = proof("classification");
  const classificationStatus: Status =
    company.classification_status === "active"
      ? classificationProof
        ? validity(documentExpiry(classificationProof.extraction))
        : SELF_DECLARED
      : company.classification_status === "needs_update"
        ? { tone: "warn", label: "Needs update" }
        : company.classification_status === "not_held"
          ? { tone: "neutral", label: "Not held" }
          : NOT_SET;

  const certStatus = (held: boolean, document: CompanyDocument | undefined): Status =>
    !held
      ? { tone: "warn", label: "Not held" }
      : document
        ? validity(documentExpiry(document.extraction))
        : SELF_DECLARED;

  const ensProof = ensLevel ? proof("cert:ENS") : undefined;

  const subtitle = [
    company.nif ? `NIF ${company.nif}` : null,
    company.employees ? `${company.employees} employees` : null,
    company.website_url ? company.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "") : null,
  ].filter(Boolean);

  return (
    <div className="company-layout">
      <main className="ledger-main">
        <header className="ledger-header">
          <div>
            <h1>{company.name}</h1>
            {subtitle.length ? <p>{subtitle.join(" · ")}</p> : null}
          </div>
          {company.updated_at ? (
            <span className="ledger-updated">
              Updated {DAY_MONTH.format(new Date(company.updated_at))}
            </span>
          ) : null}
        </header>

        {saveError ? (
          <div className="notice notice-error" role="alert">
            {saveError}
          </div>
        ) : null}

        <LedgerTable id="overview" title="Overview" note="Who you are on every bid">
          <FactRow
            id="name"
            label="Legal name"
            hint="As registered"
            value={company.name}
            editing={isEditing("name")}
            onEdit={edit("name")}
            editor={
              <TextEditor
                label="Legal name"
                initial={company.name}
                required
                onCancel={close}
                onSave={(name) => saveAndClose({ name })}
              />
            }
          />
          <FactRow
            id="nif"
            label="NIF"
            hint="Tax ID; checked against your documents"
            value={company.nif ? <span className="mono">{company.nif}</span> : <span className="fact-empty">—</span>}
            status={company.nif ? null : NOT_SET}
            editing={isEditing("nif")}
            onEdit={edit("nif")}
            editor={
              <TextEditor
                label="NIF"
                initial={company.nif}
                mono
                placeholder="B12345678"
                transform={(value) => value.toUpperCase()}
                onCancel={close}
                onSave={(nif) => saveAndClose({ nif })}
              />
            }
          />
          <FactRow
            id="website"
            label="Website"
            hint="We can read it to fill this page"
            value={
              company.website_url ? (
                <span className="fact-inline">
                  <a href={company.website_url} target="_blank" rel="noreferrer">
                    {company.website_url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                  {!importUrl ? (
                    <button
                      type="button"
                      className="link-button link-strong"
                      onClick={() => setImportUrl(company.website_url)}
                    >
                      Fill from site
                    </button>
                  ) : null}
                </span>
              ) : (
                <span className="fact-empty">—</span>
              )
            }
            status={company.website_url ? null : NOT_SET}
            editing={isEditing("website")}
            onEdit={edit("website")}
            editor={
              <TextEditor
                label="Website"
                initial={company.website_url}
                placeholder="https://yourcompany.es"
                onCancel={close}
                onSave={(website_url) => saveAndClose({ website_url })}
              />
            }
          />
          <FactRow
            id="employees"
            label="Employees"
            hint="Headcount, for SME and team criteria"
            value={company.employees ? <span className="mono">{company.employees}</span> : <span className="fact-empty">—</span>}
            status={company.employees ? null : NOT_SET}
            editing={isEditing("employees")}
            onEdit={edit("employees")}
            editor={
              <NumberEditor
                label="Employees"
                initial={company.employees}
                placeholder="25"
                onCancel={close}
                onSave={(employees) => saveAndClose({ employees })}
              />
            }
          />
        </LedgerTable>

        {importUrl ? (
          <WebsiteImport
            url={importUrl}
            companyId={company.id!}
            onApply={applySuggestion}
            onClose={() => setImportUrl(null)}
          />
        ) : null}

        <LedgerTable id="what-you-do" title="What you do" note="Decides which tenders you see">
          <FactRow
            id="description"
            label="Description"
            hint="Compared by meaning with every tender"
            value={
              company.description ? (
                <span className="fact-clamp">{company.description}</span>
              ) : (
                <span className="fact-empty">—</span>
              )
            }
            status={company.description ? IN_MATCHING : MISSING}
            editing={isEditing("description")}
            onEdit={edit("description")}
            editor={
              <TextEditor
                label="Description"
                initial={company.description}
                multiline
                placeholder="We build and maintain municipal web apps, citizen portals and cloud platforms."
                onCancel={close}
                onSave={(description) => saveAndClose({ description })}
              />
            }
          />
          <FactRow
            id="cpv"
            label="Sector codes"
            hint="CPV prefixes tenders are filed under"
            value={
              company.cpv_prefixes.length ? (
                <Tags
                  values={company.cpv_prefixes}
                  render={(code) => (
                    <>
                      <span className="mono">{code}</span> {cpvLabel(code)}
                    </>
                  )}
                />
              ) : (
                <span className="fact-empty">—</span>
              )
            }
            status={company.cpv_prefixes.length ? IN_MATCHING : hasMatchingInput ? NOT_SET : MISSING}
            editing={isEditing("cpv")}
            onEdit={edit("cpv")}
            editor={
              <ChipsEditor
                label="Sector codes"
                initial={company.cpv_prefixes}
                options={CPV_OPTIONS}
                placeholder="Search software, cloud, support…"
                onCancel={close}
                onSave={(cpv_prefixes) => saveAndClose({ cpv_prefixes })}
              />
            }
          />
          <FactRow
            id="keywords"
            label="Keywords"
            hint="Searched in tender titles, in Spanish"
            value={
              company.keywords.length ? <Tags values={company.keywords} /> : <span className="fact-empty">—</span>
            }
            status={company.keywords.length ? IN_MATCHING : hasMatchingInput ? NOT_SET : MISSING}
            editing={isEditing("keywords")}
            onEdit={edit("keywords")}
            editor={
              <ListEditor
                label="Keywords"
                initial={company.keywords}
                placeholder="aplicación, portal web, mantenimiento, nube"
                onCancel={close}
                onSave={(keywords) => saveAndClose({ keywords })}
              />
            }
          />
        </LedgerTable>

        <LedgerTable id="where-you-bid" title="Where you bid" note="Region scores and size filters">
          <FactRow
            id="regions"
            label="Regions"
            hint="Tenders here score higher"
            value={company.regions.length ? <Tags values={company.regions} /> : "Anywhere in Spain"}
            status={company.regions.length ? IN_MATCHING : { tone: "neutral", label: "Anywhere" }}
            editing={isEditing("regions")}
            onEdit={edit("regions")}
            editor={
              <ChipsEditor
                label="Regions"
                initial={company.regions}
                options={REGIONS}
                placeholder="Search autonomous communities…"
                onCancel={close}
                onSave={(regions) => saveAndClose({ regions })}
              />
            }
          />
          <FactRow
            id="national"
            label="Nationwide contracts"
            hint="Contracts delivered across Spain"
            value={company.include_national ? "Included" : "Excluded"}
            status={company.regions.length ? IN_MATCHING : null}
            editing={isEditing("national")}
            onEdit={edit("national")}
            editor={
              <ChoiceEditor
                label="Nationwide contracts"
                initial={company.include_national ? "yes" : "no"}
                options={[
                  { value: "yes", label: "Included" },
                  { value: "no", label: "Excluded" },
                ]}
                onCancel={close}
                onSave={(value) => saveAndClose({ include_national: value === "yes" })}
              />
            }
          />
          <FactRow
            id="budget"
            label="Contract size"
            hint="Budgets outside this range are hidden"
            value={
              company.min_budget === null && company.max_budget === null ? (
                "Any size"
              ) : (
                <span className="mono">
                  {company.min_budget !== null ? EURO.format(company.min_budget) : "€0"} –{" "}
                  {company.max_budget !== null ? EURO.format(company.max_budget) : "no limit"}
                </span>
              )
            }
            editing={isEditing("budget")}
            onEdit={edit("budget")}
            editor={
              <RangeEditor
                label="Contract size"
                initial={[company.min_budget, company.max_budget]}
                onCancel={close}
                onSave={([min_budget, max_budget]) => saveAndClose({ min_budget, max_budget })}
              />
            }
          />
        </LedgerTable>

        <LedgerTable id="finances" title="Finances" note="Used for economic solvency checks">
          <FactRow
            id="turnover"
            label="Annual turnover"
            hint="Best year of the last three"
            value={
              company.annual_turnover !== null ? (
                <span className="mono">{EURO.format(company.annual_turnover)}</span>
              ) : (
                <span className="fact-empty">—</span>
              )
            }
            status={company.annual_turnover !== null ? SELF_DECLARED : MISSING}
            editing={isEditing("turnover")}
            onEdit={edit("turnover")}
            editor={
              <NumberEditor
                label="Annual turnover"
                prefix="€"
                placeholder="Amount"
                initial={company.annual_turnover}
                onCancel={close}
                onSave={(annual_turnover) => saveAndClose({ annual_turnover })}
              />
            }
          />
        </LedgerTable>

        <LedgerTable id="registrations" title="Registrations" note="Must be active by the deadline">
          <FactRow
            id="rolece"
            label="ROLECE"
            hint="State bidder registry"
            value={
              company.rolece_status === "active" && company.rolece_last_verified_at
                ? `Registered · checked ${DAY_MONTH.format(new Date(company.rolece_last_verified_at))}`
                : ROLECE_VALUES[company.rolece_status]
            }
            status={roleceStatus}
            proof={proofCell(
              "rolece",
              roleceProof,
              company.rolece_status === "active" || company.rolece_status === "applied",
              "ROLECE",
            )}
            {...proofRow("rolece", "ROLECE")}
            editing={isEditing("rolece")}
            onEdit={edit("rolece")}
            editor={
              <ChoiceEditor
                label="ROLECE"
                initial={company.rolece_status}
                options={ROLECE_OPTIONS}
                onCancel={close}
                onSave={(rolece_status) =>
                  saveAndClose({
                    rolece_status,
                    rolece_last_verified_at:
                      rolece_status === "active"
                        ? new Date().toISOString()
                        : company.rolece_last_verified_at,
                  })
                }
              />
            }
          />
          <FactRow
            id="classification"
            label="Business classification"
            hint="Some tenders ask for it instead of solvency proof"
            value={
              company.classification_status === "active" && company.classification_codes.length ? (
                <span className="mono">{company.classification_codes.join(", ")}</span>
              ) : (
                CLASSIFICATION_OPTIONS.find((option) => option.value === company.classification_status)?.label
              )
            }
            status={classificationStatus}
            proof={proofCell(
              "classification",
              classificationProof,
              company.classification_status === "active",
              "Business classification",
            )}
            {...proofRow("classification", "Business classification")}
            editing={isEditing("classification")}
            onEdit={edit("classification")}
            editor={
              <ClassificationEditor
                initial={{
                  status: company.classification_status,
                  codes: company.classification_codes,
                }}
                options={CLASSIFICATION_OPTIONS}
                onCancel={close}
                onSave={({ status, codes }) =>
                  saveAndClose({
                    classification_status: status as ClassificationStatus,
                    classification_codes: codes,
                  })
                }
              />
            }
          />
        </LedgerTable>

        <LedgerTable
          id="certifications"
          title="Certifications"
          note="Checked against tender requirements"
          footer={
            addableCerts.length ? (
              <label className="add-cert">
                <span>+ Add another certification</span>
                <select
                  value=""
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value) void saveFields({ certifications: [...company.certifications, value] });
                  }}
                >
                  <option value="">Choose…</option>
                  {addableCerts.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} · {option.description}
                    </option>
                  ))}
                </select>
              </label>
            ) : null
          }
        >
          {CORE_CERTS.map((cert) => {
            const held = company.certifications.includes(cert.value);
            const key = certProofKey(cert.value);
            const document = held ? proof(key) : undefined;
            const id = `cert:${cert.value}`;
            return (
              <FactRow
                key={cert.value}
                id={id}
                label={cert.label}
                hint={cert.hint}
                value={held ? "Certified" : "Not held"}
                status={certStatus(held, document)}
                proof={proofCell(key, document, held, cert.label)}
                {...proofRow(key, cert.label)}
                editing={isEditing(id)}
                onEdit={edit(id)}
                editor={
                  <ChoiceEditor
                    label={cert.label}
                    initial={held ? "held" : "none"}
                    options={[
                      { value: "held", label: "Certified" },
                      { value: "none", label: "Not held" },
                    ]}
                    onCancel={close}
                    onSave={(value) =>
                      saveAndClose({
                        certifications:
                          value === "held"
                            ? [...new Set([...company.certifications, cert.value])]
                            : company.certifications.filter((item) => item !== cert.value),
                      })
                    }
                  />
                }
              />
            );
          })}
          <FactRow
            id="cert:ENS"
            label="ENS"
            hint="Esquema Nacional de Seguridad"
            value={ensLevel ? ENS_LABELS[ensLevel] : "Not held"}
            status={certStatus(Boolean(ensLevel), ensProof)}
            proof={proofCell("cert:ENS", ensProof, Boolean(ensLevel), "ENS")}
            {...proofRow("cert:ENS", "ENS")}
            editing={isEditing("cert:ENS")}
            onEdit={edit("cert:ENS")}
            editor={
              <ChoiceEditor
                label="ENS category"
                initial={ensLevel ?? "none"}
                options={[
                  { value: "none", label: "Not held" },
                  ...ENS_LEVELS.map((level) => ({ value: level, label: ENS_LABELS[level] })),
                ]}
                onCancel={close}
                onSave={(value) =>
                  saveAndClose({
                    certifications: [
                      ...company.certifications.filter((item) => !isEnsLevel(item)),
                      ...(value === "none" ? [] : [value]),
                    ],
                  })
                }
              />
            }
          />
          {otherCerts.map((value) => {
            const option = CERTIFICATIONS.find((candidate) => candidate.value === value);
            const key = certProofKey(value);
            const document = proof(key);
            const label = option?.label ?? value;
            return (
              <FactRow
                key={value}
                id={`cert:${value}`}
                label={option?.label ?? value}
                hint={`${option?.description ?? "Certification"} · kept for bid prep`}
                value="Certified"
                status={certStatus(true, document)}
                proof={proofCell(key, document, true, label)}
                {...proofRow(key, label)}
                action={
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      void saveFields({
                        certifications: company.certifications.filter((item) => item !== value),
                      })
                    }
                  >
                    Remove<span className="sr-only"> {option?.label ?? value}</span>
                  </button>
                }
              />
            );
          })}
        </LedgerTable>

        <DocumentsPanel
          documents={docs.documents}
          uploads={docs.uploads}
          errors={docs.errors}
          companyNif={company.nif}
          dragging={drag.active && !drag.target}
          onPick={() => pickFiles()}
          onConfirm={(document) => void docs.confirm(document)}
          onReject={(document) => void docs.reject(document)}
          onRetry={(document) => void docs.retry(document)}
          onOpen={(document) => void docs.open(document)}
          onDismissUpload={docs.dismissUpload}
        />

        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept=".pdf,.xml,.zip,application/pdf,application/xml,text/xml,application/zip"
          onChange={(event) => {
            const target = pickTarget.current;
            if (event.target.files?.length) {
              docs.upload(event.target.files, target);
              if (!target) document.getElementById("documents")?.scrollIntoView({ behavior: "smooth" });
            }
            pickTarget.current = undefined;
            event.target.value = "";
          }}
        />
      </main>

      {drag.active ? (
        <div className="drop-overlay" aria-hidden="true">
          <span className="drop-overlay-pill">
            {drag.target
              ? "Release to attach it to this row"
              : "Drop anywhere to add to Documents, or onto a certificate row to attach it as proof"}
          </span>
        </div>
      ) : null}

      <GapRail company={company} revision={revision} onAction={handleGap} />
    </div>
  );
}
