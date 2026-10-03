import { extractionCertification, isEnsLevel } from "./profile";
import type { CompanyDocument, DocumentExtraction } from "./types";

// A fact on the company page that a document can prove.
// Certifications use their catalogue value; every ENS category shares "cert:ENS".
export type ProofKey = "rolece" | "classification" | `cert:${string}`;

export function certProofKey(certification: string): ProofKey {
  return isEnsLevel(certification) ? "cert:ENS" : `cert:${certification}`;
}

export function documentProves(extraction: DocumentExtraction | null, documentType = "") {
  if (!extraction) return [] as ProofKey[];
  const keys: ProofKey[] = [];
  const certification = extractionCertification(extraction);
  if (certification) keys.push(certProofKey(certification));
  if (extraction.rolece || /rolece/i.test(extraction.document_type || documentType)) {
    keys.push("rolece");
  }
  if (extraction.rolece?.classifications.length) keys.push("classification");
  return keys;
}

// Newest confirmed document backing a fact.
export function proofFor(key: ProofKey, documents: CompanyDocument[]) {
  return documents
    .filter(
      (document) =>
        document.processing_status === "ready" &&
        documentProves(document.extraction, document.document_type).includes(key),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

export function documentExpiry(extraction: DocumentExtraction | null) {
  return extraction?.expiry_date || extraction?.ens?.renewal_date || null;
}

export type Tone = "good" | "warn" | "neutral";

const MONTH_YEAR = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
const DAY = 24 * 60 * 60 * 1000;

export function validity(expiry: string | null, now = new Date()): { tone: Tone; label: string } {
  if (!expiry) return { tone: "good", label: "Verified" };
  const date = new Date(expiry);
  if (Number.isNaN(date.getTime())) return { tone: "neutral", label: `Valid to ${expiry}` };

  const days = Math.floor((date.getTime() - now.getTime()) / DAY);
  if (days < 0) return { tone: "warn", label: `Expired ${MONTH_YEAR.format(date)}` };
  if (days < 14) return { tone: "warn", label: `Expires in ${days} days` };
  if (days < 90) return { tone: "warn", label: `Expires in ${Math.floor(days / 7)} weeks` };
  return { tone: "good", label: `Valid to ${MONTH_YEAR.format(date)}` };
}

// Short label for a document chip: the file name without extension or upload prefix.
export function documentLabel(name: string) {
  return name.replace(/\.[a-z0-9]{2,4}$/i, "");
}

// One-line reading of what a document says, for the review row.
export function describeExtraction(extraction: DocumentExtraction) {
  const certification = extractionCertification(extraction);
  const what = certification
    ? certification.startsWith("ENS_")
      ? `ENS ${certification.slice(4).toLowerCase()} category`
      : extraction.credential_code || certification
    : extraction.rolece
      ? "ROLECE registration"
      : extraction.document_type || "Company document";
  const expiry = documentExpiry(extraction);
  const parts = [what];
  if (extraction.legal_entity_name) parts.push(`for ${extraction.legal_entity_name}`);
  if (expiry) parts.push(`valid to ${expiry}`);
  if (extraction.rolece?.classifications.length) {
    parts.push(`classification ${extraction.rolece.classifications.join(", ")}`);
  }
  return parts.join(", ");
}
