import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { extractCompanyDocument } from "@/lib/ai";
import {
  extractPdfPages,
  extractStructuredText,
  verifyDocumentCitation,
} from "@/lib/documents";
import { createClient } from "@/lib/supabase/server";
import type { DocumentExtraction } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const RequestSchema = z.object({
  documentId: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before extracting a document." }, { status: 401 });
  }

  const parsed = RequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid document request." }, { status: 400 });
  }

  const { data: document, error: documentError } = await supabase
    .from("company_documents")
    .select("id,company_id,storage_path,original_name,mime_type")
    .eq("id", parsed.data.documentId)
    .single();

  if (documentError || !document) {
    return NextResponse.json({ error: "Document not found or access denied." }, { status: 404 });
  }

  await supabase
    .from("company_documents")
    .update({ processing_status: "extracting", updated_at: new Date().toISOString() })
    .eq("id", document.id);

  try {
    const { data: blob, error: downloadError } = await supabase.storage
      .from("company-documents")
      .download(document.storage_path);
    if (downloadError || !blob) throw downloadError || new Error("Document download failed.");

    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.byteLength > 20 * 1024 * 1024) {
      throw new Error("Document exceeds the 20 MB extraction limit.");
    }

    const mimeType = document.mime_type || blob.type || "application/octet-stream";
    const isPdf =
      mimeType === "application/pdf" ||
      document.original_name.toLowerCase().endsWith(".pdf");
    const pages = isPdf ? await extractPdfPages(bytes) : [];
    const extractedText = isPdf
      ? pages.map((page, index) => `=== PAGE ${index + 1} ===\n${page}`).join("\n\n")
      : await extractStructuredText(bytes, mimeType, document.original_name);

    let extraction = (await extractCompanyDocument({
      filename: document.original_name,
      mimeType,
      bytes,
      extractedText,
    })) as DocumentExtraction;

    if (isPdf) {
      extraction = verifyDocumentCitation(extraction, pages);
    } else if (extraction.source_quote) {
      const normalizedText = extractedText.toLowerCase().replace(/\s+/g, " ");
      const probe = extraction.source_quote
        .toLowerCase()
        .replace(/\s+/g, " ")
        .split(" ")
        .slice(0, 8)
        .join(" ");
      extraction = { ...extraction, verified: Boolean(probe && normalizedText.includes(probe)) };
    }

    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { error: updateError } = await supabase
      .from("company_documents")
      .update({
        sha256,
        document_type: extraction.document_type || "other",
        extraction,
        processing_status: "needs_review",
        updated_at: new Date().toISOString(),
      })
      .eq("id", document.id);
    if (updateError) throw updateError;

    return NextResponse.json({ extraction });
  } catch (error) {
    await supabase
      .from("company_documents")
      .update({
        processing_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", document.id);

    const message = error instanceof Error ? error.message : "Document extraction failed.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
