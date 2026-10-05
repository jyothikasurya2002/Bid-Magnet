import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { DocumentExtraction } from "./types";

export function normalizeEvidence(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function extractPdfPages(bytes: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  }).promise;

  const pages: string[] = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
  }
  return pages;
}

function xmlToText(xml: string) {
  try {
    const parsed = new XMLParser({
      ignoreAttributes: false,
      trimValues: true,
    }).parse(xml);
    return JSON.stringify(parsed);
  } catch {
    return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

export async function extractStructuredText(
  bytes: Buffer,
  mimeType: string,
  filename: string,
) {
  if (mimeType.includes("zip") || filename.toLowerCase().endsWith(".zip")) {
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files).filter(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".xml"),
    );
    const chunks = await Promise.all(
      entries.slice(0, 10).map(async (entry) => {
        const xml = await entry.async("text");
        return `=== ${entry.name} ===\n${xmlToText(xml)}`;
      }),
    );
    return chunks.join("\n\n").slice(0, 100_000);
  }

  const text = bytes.toString("utf8");
  return xmlToText(text).slice(0, 100_000);
}

export function verifyDocumentCitation(
  extraction: DocumentExtraction,
  pages: string[],
) {
  const quote = normalizeEvidence(extraction.source_quote || "");
  const probe = quote.split(" ").slice(0, 8).join(" ");
  if (!probe) return { ...extraction, verified: false };

  const requestedPage = extraction.source_page;
  const candidateIndexes = requestedPage
    ? [requestedPage - 1, requestedPage - 2, requestedPage]
    : pages.map((_, index) => index);

  for (const index of candidateIndexes) {
    if (index >= 0 && index < pages.length) {
      if (normalizeEvidence(pages[index]).includes(probe)) {
        return { ...extraction, source_page: index + 1, verified: true };
      }
    }
  }

  return {
    ...extraction,
    verified: false,
    warnings: [
      ...extraction.warnings,
      "The cited quote could not be verified against the extracted document text.",
    ],
  };
}
