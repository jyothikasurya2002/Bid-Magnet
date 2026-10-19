"use client";

import { describeExtraction, documentProves, type ProofKey } from "@/lib/evidence";
import type { CompanyDocument } from "@/lib/types";
import { DocChip } from "./FactRow";
import type { PendingUpload } from "./useCompanyDocuments";

type RowUploadProps = {
  proofKey: ProofKey;
  label: string;
  upload?: PendingUpload;
  document?: CompanyDocument;
  error?: string;
  companyNif: string;
  onConfirm: (document: CompanyDocument) => void;
  onReject: (document: CompanyDocument) => void;
  onRetry: (document: CompanyDocument) => void;
  onOpen: (document: CompanyDocument) => void;
  onDismiss: () => void;
};

// What happens to a file uploaded from a row, shown inside that row.
export function RowUpload({
  proofKey,
  label,
  upload,
  document,
  error,
  companyNif,
  onConfirm,
  onReject,
  onRetry,
  onOpen,
  onDismiss,
}: RowUploadProps) {
  if (upload) {
    return (
      <div className="row-upload" role="status">
        <DocChip document={{ original_name: upload.name, mime_type: "" }} />
        {upload.error ? (
          <>
            <span className="row-upload-text doc-text-error">{upload.error}</span>
            <button type="button" className="link-button" onClick={onDismiss}>
              Dismiss
            </button>
          </>
        ) : (
          <>
            <span className="row-upload-text">Uploading…</span>
            <span className="doc-progress" aria-hidden="true">
              <span style={{ width: `${upload.progress}%` }} />
            </span>
          </>
        )}
      </div>
    );
  }

  if (!document) return null;
  const open = () => onOpen(document);
  const status = document.processing_status;

  if (status === "uploaded" || status === "extracting") {
    return (
      <div className="row-upload" role="status">
        <DocChip document={document} onOpen={open} />
        <span className="row-upload-text">Reading the certificate…</span>
        <span className="doc-progress doc-progress-busy" aria-hidden="true">
          <span />
        </span>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="row-upload" role="alert">
        <DocChip document={document} onOpen={open} />
        <span className="row-upload-text doc-text-error">{error || "We couldn't read this file."}</span>
        <button type="button" className="link-button link-strong" onClick={() => onRetry(document)}>
          Try again
        </button>
        <button type="button" className="link-button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    );
  }

  if (status !== "needs_review" || !document.extraction) return null;

  const extraction = document.extraction;
  const proves = documentProves(extraction, document.document_type);
  const foundNif = extraction.nif?.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const ourNif = companyNif.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const warnings = [
    proves.includes(proofKey)
      ? null
      : `This doesn't read as ${label}. Confirming saves what it does say instead.`,
    foundNif && ourNif && foundNif !== ourNif
      ? `Issued to NIF ${foundNif}, but your profile says ${ourNif}.`
      : null,
    extraction.verified ? null : "We couldn't match a quote in the file. Check it before confirming.",
  ].filter(Boolean) as string[];

  return (
    <div className="row-upload row-upload-review">
      <DocChip document={document} onOpen={open} />
      <span className="row-upload-text">
        <span className="doc-read">Read: {describeExtraction(extraction)}</span>
        {warnings.map((warning) => (
          <small key={warning}>{warning}</small>
        ))}
        {error ? <small className="doc-text-error">{error}</small> : null}
      </span>
      <button type="button" className="button button-dark button-small" onClick={() => onConfirm(document)}>
        Confirm
      </button>
      <button type="button" className="link-button" onClick={() => onReject(document)}>
        Not right
      </button>
    </div>
  );
}
