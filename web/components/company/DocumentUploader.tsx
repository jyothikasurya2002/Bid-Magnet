"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  DocumentExtraction,
  DocumentProcessingStatus,
} from "@/lib/types";

type UploadItem = {
  localId: string;
  name: string;
  size: number;
  progress: number;
  status: DocumentProcessingStatus | "validating";
  error?: string;
  documentId?: string;
  extraction?: DocumentExtraction;
};

type DocumentUploaderProps = {
  companyId?: string;
  userId: string;
  onAcceptExtraction: (extraction: DocumentExtraction) => void;
};

const ACCEPTED = [
  "application/pdf",
  "application/xml",
  "text/xml",
  "application/zip",
  "application/x-zip-compressed",
];
const MAX_SIZE = 20 * 1024 * 1024;

function sizeLabel(size: number) {
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function safeFilename(filename: string) {
  return filename.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-140);
}

export function DocumentUploader({
  companyId,
  userId,
  onAcceptExtraction,
}: DocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);

  function update(localId: string, change: Partial<UploadItem>) {
    setItems((current) =>
      current.map((item) => (item.localId === localId ? { ...item, ...change } : item)),
    );
  }

  async function uploadFile(file: File) {
    const localId = crypto.randomUUID();
    const base: UploadItem = {
      localId,
      name: file.name,
      size: file.size,
      progress: 0,
      status: "validating",
    };
    setItems((current) => [...current, base]);

    if (!companyId) {
      update(localId, {
        status: "failed",
        error: "Save the company essentials before uploading evidence.",
      });
      return;
    }
    if (!ACCEPTED.includes(file.type) && !/\.(pdf|xml|zip)$/i.test(file.name)) {
      update(localId, {
        status: "failed",
        error: "Choose a PDF, XML or ZIP file.",
      });
      return;
    }
    if (!file.size) {
      update(localId, { status: "failed", error: "The selected file is empty." });
      return;
    }
    if (file.size > MAX_SIZE) {
      update(localId, {
        status: "failed",
        error: "The selected file must be smaller than 20 MB.",
      });
      return;
    }

    try {
      update(localId, { status: "uploaded", progress: 12 });
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const path = `${userId}/${companyId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
      const supabase = createClient();

      update(localId, { progress: 28 });
      const { error: uploadError } = await supabase.storage
        .from("company-documents")
        .upload(path, file, {
          cacheControl: "3600",
          contentType: file.type || undefined,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      update(localId, { progress: 58 });
      const now = new Date().toISOString();
      const { data: record, error: insertError } = await supabase
        .from("company_documents")
        .insert({
          company_id: companyId,
          storage_path: path,
          original_name: file.name,
          mime_type: file.type || "application/octet-stream",
          byte_size: file.size,
          sha256,
          document_type: "unknown",
          processing_status: "uploaded",
          extraction: null,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();
      if (insertError || !record) throw insertError || new Error("Document record failed.");

      update(localId, {
        documentId: record.id,
        status: "extracting",
        progress: 72,
      });
      const response = await fetch("/api/company/extract-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: record.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Document extraction failed.");

      update(localId, {
        status: "needs_review",
        progress: 100,
        extraction: result.extraction,
      });
    } catch (error) {
      update(localId, {
        status: "failed",
        error: error instanceof Error ? error.message : "Upload failed. Try again.",
      });
    }
  }

  async function accept(item: UploadItem) {
    if (!item.documentId || !item.extraction) return;
    const supabase = createClient();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("company_documents")
      .update({
        processing_status: "ready",
        reviewed_at: now,
        reviewed_by: userId,
        updated_at: now,
      })
      .eq("id", item.documentId);
    if (error) {
      update(item.localId, { error: error.message });
      return;
    }
    onAcceptExtraction(item.extraction);
    update(item.localId, { status: "ready", error: undefined });
  }

  function handleFiles(files: FileList | File[]) {
    Array.from(files).forEach((file) => void uploadFile(file));
  }

  return (
    <div>
      <div
        className={`upload-zone ${dragging ? "upload-zone-dragging" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.xml,.zip,application/pdf,application/xml,text/xml,application/zip"
          onChange={(event) => event.target.files && handleFiles(event.target.files)}
        />
        <div>
          <strong>Add company evidence</strong>
          <p>
            Drag files here or choose them from your device. PDF, signed ROLECE
            XML/ZIP, up to 20 MB. Upload only documents you are authorised to use.
          </p>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => inputRef.current?.click()}
          >
            Choose files
          </button>
        </div>
      </div>

      {items.length ? (
        <div className="upload-list" aria-live="polite">
          {items.map((item) => (
            <div className="upload-row" key={item.localId}>
              <div className="upload-file">
                <strong>{item.name}</strong>
                <small>
                  {sizeLabel(item.size)} ·{" "}
                  {item.status === "needs_review"
                    ? "Needs review"
                    : item.status.replace("_", " ")}
                </small>
                {item.error ? <p className="field-error">{item.error}</p> : null}
                {item.extraction ? (
                  <details className="source-details">
                    <summary>Review extracted details</summary>
                    <blockquote>
                      <strong>
                        {item.extraction.credential_code ||
                          item.extraction.document_type ||
                          "Company evidence"}
                      </strong>
                      <br />
                      {item.extraction.scope || "No scope extracted."}
                      {item.extraction.source_quote ? (
                        <>
                          <br />“{item.extraction.source_quote}”
                        </>
                      ) : null}
                    </blockquote>
                  </details>
                ) : null}
              </div>
              {item.progress < 100 && item.status !== "failed" ? (
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-label={`Upload progress for ${item.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={item.progress}
                >
                  <div className="progress-value" style={{ width: `${item.progress}%` }} />
                </div>
              ) : (
                <span
                  className={`badge ${
                    item.status === "ready"
                      ? "badge-success"
                      : item.status === "failed"
                        ? "badge-error"
                        : "badge-warning"
                  }`}
                >
                  {item.status === "ready"
                    ? "Ready"
                    : item.status === "failed"
                      ? "Failed"
                      : "Review"}
                </span>
              )}
              {item.status === "needs_review" ? (
                <button
                  type="button"
                  className="button button-quiet button-small"
                  onClick={() => void accept(item)}
                >
                  Use details
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
