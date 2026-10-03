"use client";

import { useState } from "react";
import { describeExtraction } from "@/lib/evidence";
import type { CompanyDocument } from "@/lib/types";
import { DocChip } from "./FactRow";
import type { PendingUpload } from "./useCompanyDocuments";

type DocumentsPanelProps = {
  documents: CompanyDocument[];
  uploads: PendingUpload[];
  errors: Record<string, string>;
  companyNif: string;
  onPick: () => void;
  onDrop: (files: FileList) => void;
  onConfirm: (document: CompanyDocument) => void;
  onReject: (document: CompanyDocument) => void;
  onRetry: (document: CompanyDocument) => void;
  onOpen: (document: CompanyDocument) => void;
  onDismissUpload: (localId: string) => void;
};

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

function nifWarning(document: CompanyDocument, companyNif: string) {
  const found = document.extraction?.nif?.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  const ours = companyNif.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return found && ours && found !== ours
    ? `Issued to NIF ${found}, but your profile says ${ours}.`
    : null;
}

export function DocumentsPanel({
  documents,
  uploads,
  errors,
  companyNif,
  onPick,
  onDrop,
  onConfirm,
  onReject,
  onRetry,
  onOpen,
  onDismissUpload,
}: DocumentsPanelProps) {
  const [dragging, setDragging] = useState(false);
  const toReview = documents.filter((document) => document.processing_status === "needs_review");
  const rest = documents.filter((document) => document.processing_status !== "needs_review");

  return (
    <section className="ledger-section" id="documents" aria-labelledby="documents-title">
      <div className="ledger-section-head">
        <h2 id="documents-title">Documents</h2>
        <span>
          {documents.length
            ? `${documents.length} on file · confirmed ones back the facts above`
            : "Certificates and registry extracts back the facts above"}
        </span>
      </div>

      <div
        className={`dropzone${dragging ? " dropzone-active" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files.length) onDrop(event.dataTransfer.files);
        }}
      >
        <span className="dropzone-icon" aria-hidden="true">
          ↑
        </span>
        <div className="dropzone-copy">
          <strong>Drop documents to update your profile</strong>
          <span>
            ISO and ENS certificates, ROLECE extracts (the signed XML/ZIP is best). We read
            each one and you confirm before anything changes. PDF, XML or ZIP up to 20 MB.
          </span>
        </div>
        <button type="button" className="button button-dark" onClick={onPick}>
          Choose files
        </button>
      </div>

      <div className="doc-list" aria-live="polite">
        {uploads.map((upload) => (
          <div className="doc-row" key={upload.localId}>
            <DocChip document={{ original_name: upload.name, mime_type: "" }} />
            {upload.error ? (
              <>
                <span className="doc-text doc-text-error">{upload.error}</span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onDismissUpload(upload.localId)}
                >
                  Dismiss
                </button>
              </>
            ) : (
              <>
                <span className="doc-text">Uploading…</span>
                <span className="doc-progress" aria-hidden="true">
                  <span style={{ width: `${upload.progress}%` }} />
                </span>
              </>
            )}
          </div>
        ))}

        {[...toReview, ...rest].map((document) => {
          const error = errors[document.id];
          const open = () => onOpen(document);
          const status = document.processing_status;

          if (status === "needs_review" && document.extraction) {
            const warnings = [
              nifWarning(document, companyNif),
              document.extraction.verified
                ? null
                : "We couldn't match a quote to the file. Check it before confirming.",
            ].filter(Boolean);
            return (
              <div className="doc-row doc-row-review" key={document.id}>
                <DocChip document={document} onOpen={open} />
                <span className="doc-text">
                  <span className="doc-read">Read: {describeExtraction(document.extraction)}</span>
                  {warnings.map((warning) => (
                    <small key={warning}>{warning}</small>
                  ))}
                  {error ? <small className="doc-text-error">{error}</small> : null}
                </span>
                <button type="button" className="link-button link-strong" onClick={() => onConfirm(document)}>
                  Confirm
                </button>
                <button type="button" className="link-button" onClick={() => onReject(document)}>
                  Not right
                </button>
              </div>
            );
          }

          if (status === "uploaded" || status === "extracting") {
            return (
              <div className="doc-row" key={document.id}>
                <DocChip document={document} onOpen={open} />
                <span className="doc-text">Reading the document…</span>
                <span className="doc-progress doc-progress-busy" aria-hidden="true">
                  <span />
                </span>
              </div>
            );
          }

          if (status === "failed") {
            return (
              <div className="doc-row" key={document.id}>
                <DocChip document={document} onOpen={open} />
                <span className="doc-text doc-text-muted">
                  {document.reviewed_at
                    ? "You marked our reading as wrong. Kept on file, not linked to any fact."
                    : error || "We couldn't read this file."}
                </span>
                <button type="button" className="link-button" onClick={() => onRetry(document)}>
                  Read again
                </button>
              </div>
            );
          }

          return (
            <div className="doc-row" key={document.id}>
              <DocChip document={document} onOpen={open} />
              <span className="doc-text doc-text-muted">
                {document.extraction ? describeExtraction(document.extraction) : document.document_type}
                {error ? <small className="doc-text-error">{error}</small> : null}
              </span>
              <span className="doc-date">{DATE.format(new Date(document.created_at))}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
