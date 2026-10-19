"use client";

import { useState } from "react";
import type { ProofKey } from "@/lib/evidence";
import { createClient } from "@/lib/supabase/client";
import type { CompanyDocument, DocumentExtraction } from "@/lib/types";

export type PendingUpload = {
  localId: string;
  name: string;
  progress: number;
  error?: string;
  // the ledger row the file was uploaded or dropped on, if any
  target?: ProofKey;
};

const BUCKET = "company-documents";
const ACCEPTED = [
  "application/pdf",
  "application/xml",
  "text/xml",
  "application/zip",
  "application/x-zip-compressed",
];
const MAX_SIZE = 20 * 1024 * 1024;

function safeFilename(filename: string) {
  return filename.normalize("NFKD").replace(/[^\w.\-]+/g, "_").slice(-140);
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function useCompanyDocuments({
  companyId,
  userId,
  initial,
  onConfirmed,
}: {
  companyId?: string;
  userId: string;
  initial: CompanyDocument[];
  onConfirmed: (extraction: DocumentExtraction) => Promise<boolean>;
}) {
  const [documents, setDocuments] = useState(initial);
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // document id -> the row it was uploaded from, so that row can show its progress and review
  const [targets, setTargets] = useState<Record<string, ProofKey>>({});

  function patchDocument(id: string, change: Partial<CompanyDocument>) {
    setDocuments((current) =>
      current.map((document) => (document.id === id ? { ...document, ...change } : document)),
    );
  }

  function setError(id: string, message?: string) {
    setErrors((current) => {
      const next = { ...current };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  async function extract(id: string) {
    patchDocument(id, { processing_status: "extracting" });
    setError(id);
    try {
      const response = await fetch("/api/company/extract-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "We couldn't read this file.");
      patchDocument(id, {
        processing_status: "needs_review",
        extraction: result.extraction,
        document_type: result.extraction.document_type || "other",
      });
    } catch (error) {
      patchDocument(id, { processing_status: "failed" });
      setError(id, error instanceof Error ? error.message : "We couldn't read this file.");
    }
  }

  async function upload(file: File, target?: ProofKey) {
    const localId = crypto.randomUUID();
    const fail = (message: string) =>
      setUploads((current) =>
        current.map((item) => (item.localId === localId ? { ...item, error: message } : item)),
      );
    const progress = (value: number) =>
      setUploads((current) =>
        current.map((item) => (item.localId === localId ? { ...item, progress: value } : item)),
      );
    setUploads((current) => [{ localId, name: file.name, progress: 5, target }, ...current]);

    if (!companyId) return fail("Create the company profile before adding documents.");
    if (!ACCEPTED.includes(file.type) && !/\.(pdf|xml|zip)$/i.test(file.name)) {
      return fail("Use a PDF, or the signed XML/ZIP from ROLECE.");
    }
    if (!file.size) return fail("This file is empty.");
    if (file.size > MAX_SIZE) return fail("Files must be smaller than 20 MB.");

    try {
      const supabase = createClient();
      // Storage policies require the company id as the first folder.
      const path = `${companyId}/${crypto.randomUUID()}-${safeFilename(file.name)}`;
      const hash = await sha256(await file.arrayBuffer());
      progress(25);

      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: "3600",
        contentType: file.type || undefined,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      progress(70);

      const now = new Date().toISOString();
      const { data: record, error: insertError } = await supabase
        .from("company_documents")
        .insert({
          company_id: companyId,
          storage_path: path,
          original_name: file.name,
          mime_type: file.type || "application/octet-stream",
          byte_size: file.size,
          sha256: hash,
          document_type: "unknown",
          processing_status: "uploaded",
          extraction: null,
          created_at: now,
          updated_at: now,
        })
        .select("*")
        .single();
      if (insertError || !record) throw insertError || new Error("The file record could not be saved.");

      setUploads((current) => current.filter((item) => item.localId !== localId));
      if (target) setTargets((current) => ({ ...current, [record.id]: target }));
      setDocuments((current) => [record as CompanyDocument, ...current]);
      await extract(record.id);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Upload failed. Try again.");
    }
  }

  async function review(document: CompanyDocument, accepted: boolean) {
    const now = new Date().toISOString();
    const status = accepted ? "ready" : "failed";
    const { error } = await createClient()
      .from("company_documents")
      .update({ processing_status: status, reviewed_at: now, reviewed_by: userId, updated_at: now })
      .eq("id", document.id);
    if (error) {
      setError(document.id, error.message);
      return;
    }
    if (accepted && document.extraction) {
      const saved = await onConfirmed(document.extraction);
      if (!saved) {
        setError(document.id, "The document is confirmed but the profile didn't update. Try again.");
        patchDocument(document.id, { processing_status: status, reviewed_at: now, reviewed_by: userId });
        return;
      }
    }
    patchDocument(document.id, { processing_status: status, reviewed_at: now, reviewed_by: userId });
    setError(document.id);
    setTargets((current) => {
      const next = { ...current };
      delete next[document.id];
      return next;
    });
  }

  async function open(document: CompanyDocument) {
    // Open the tab now so the browser treats it as a click, then point it at the signed URL.
    const tab = window.open("", "_blank");
    const { data, error } = await createClient()
      .storage.from(BUCKET)
      .createSignedUrl(document.storage_path, 120);
    if (error || !data) {
      tab?.close();
      setError(document.id, error?.message || "The file could not be opened.");
      return;
    }
    if (tab) tab.location.href = data.signedUrl;
  }

  return {
    documents,
    uploads,
    errors,
    targets,
    upload: (files: FileList | File[], target?: ProofKey) =>
      Array.from(files).forEach((file) => void upload(file, target)),
    dismissUpload: (localId: string) =>
      setUploads((current) => current.filter((item) => item.localId !== localId)),
    dismissTarget: (documentId: string) =>
      setTargets((current) => {
        const next = { ...current };
        delete next[documentId];
        return next;
      }),
    confirm: (document: CompanyDocument) => review(document, true),
    reject: (document: CompanyDocument) => review(document, false),
    retry: (document: CompanyDocument) => extract(document.id),
    open,
  };
}
