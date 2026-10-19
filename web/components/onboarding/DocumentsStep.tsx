"use client";

import { useRef, useState } from "react";
import { describeExtraction } from "@/lib/evidence";
import type { CompanyDocument, DocumentExtraction } from "@/lib/types";
import { DocChip } from "@/components/company/FactRow";
import { useCompanyDocuments } from "@/components/company/useCompanyDocuments";

type DocumentsStepProps = {
  companyId: string;
  userId: string;
  initial: CompanyDocument[];
  onConfirmed: (extraction: DocumentExtraction) => Promise<boolean>;
};

export function DocumentsStep({ companyId, userId, initial, onConfirmed }: DocumentsStepProps) {
  const docs = useCompanyDocuments({ companyId, userId, initial, onConfirmed });
  const input = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  return (
    <>
      <div
        className={dragging ? "ob-drop ob-drop-on" : "ob-drop"}
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          depth.current = 0;
          setDragging(false);
          if (event.dataTransfer.files.length) docs.upload(event.dataTransfer.files);
        }}
      >
        <span className="ob-drop-icon" aria-hidden="true">
          ↑
        </span>
        <strong>{dragging ? "Drop to add" : "Drop certificates or your ROLECE extract"}</strong>
        <span>
          or{" "}
          <button type="button" className="link-button link-strong" onClick={() => input.current?.click()}>
            browse your files
          </button>{" "}
          · PDF, XML or ZIP up to 20 MB
        </span>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".pdf,.xml,.zip,application/pdf,application/xml,text/xml,application/zip"
          onChange={(event) => {
            if (event.target.files?.length) docs.upload(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {docs.uploads.length || docs.documents.length ? (
        <div className="ob-files" aria-live="polite">
          {docs.uploads.map((upload) => (
            <div className="ob-file" key={upload.localId}>
              <DocChip document={{ original_name: upload.name, mime_type: "" }} />
              {upload.error ? (
                <>
                  <span className="ob-file-text doc-text-error">{upload.error}</span>
                  <button type="button" className="link-button" onClick={() => docs.dismissUpload(upload.localId)}>
                    Dismiss
                  </button>
                </>
              ) : (
                <span className="ob-file-text ob-shimmer-text">Uploading…</span>
              )}
            </div>
          ))}
          {docs.documents.map((document) => {
            const status = document.processing_status;
            const error = docs.errors[document.id];
            return (
              <div className={status === "needs_review" ? "ob-file ob-file-review" : "ob-file"} key={document.id}>
                <DocChip document={document} onOpen={() => void docs.open(document)} />
                {status === "uploaded" || status === "extracting" ? (
                  <span className="ob-file-text ob-shimmer-text">Reading…</span>
                ) : status === "needs_review" && document.extraction ? (
                  <>
                    <span className="ob-file-text">{describeExtraction(document.extraction)}</span>
                    <button type="button" className="button button-dark button-small" onClick={() => void docs.confirm(document)}>
                      Confirm
                    </button>
                    <button type="button" className="link-button" onClick={() => void docs.reject(document)}>
                      Not right
                    </button>
                  </>
                ) : status === "ready" ? (
                  <span className="ob-file-text ob-file-done">
                    <span className="ob-source-dot" aria-hidden="true" />
                    {document.extraction ? describeExtraction(document.extraction) : "Saved"}
                  </span>
                ) : (
                  <>
                    <span className="ob-file-text doc-text-error">
                      {document.reviewed_at ? "Not used" : error || "We couldn't read this file."}
                    </span>
                    {!document.reviewed_at ? (
                      <button type="button" className="link-button" onClick={() => void docs.retry(document)}>
                        Try again
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
