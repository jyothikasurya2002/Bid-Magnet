import { CERTIFICATIONS, REGIONS } from "./catalog";
import {
  EMPTY_COMPANY,
  type CompanyProfile,
  type DocumentExtraction,
  type ImportSuggestion,
} from "./types";

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function canonicalCertification(value: string) {
  const target = normalized(value);
  return CERTIFICATIONS.find(
    (option) =>
      normalized(option.value) === target ||
      normalized(option.label) === target ||
      target.includes(normalized(option.value)),
  )?.value;
}

export function canonicalRegion(value: string) {
  const target = normalized(value);
  return REGIONS.find((option) => normalized(option.value) === target)?.value;
}

export const ENS_LEVELS = ["ENS_BASICA", "ENS_MEDIA", "ENS_ALTA"] as const;

export function isEnsLevel(value: string) {
  return (ENS_LEVELS as readonly string[]).includes(value);
}

export function applyImportSuggestion(
  company: CompanyProfile,
  suggestion: ImportSuggestion,
) {
  const values = suggestion.values.length
    ? suggestion.values
    : suggestion.value_text
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

  if (suggestion.field === "keywords") {
    return { ...company, keywords: [...new Set([...company.keywords, ...values])] };
  }
  if (suggestion.field === "cpv_prefixes") {
    const codes = values
      .map((value) => value.match(/\d{2,8}/)?.[0])
      .filter(Boolean) as string[];
    return {
      ...company,
      cpv_prefixes: [...new Set([...company.cpv_prefixes, ...codes])],
    };
  }
  if (suggestion.field === "regions") {
    const regions = values.map(canonicalRegion).filter(Boolean) as string[];
    return { ...company, regions: [...new Set([...company.regions, ...regions])] };
  }
  if (suggestion.field === "certifications") {
    const certifications = values
      .map(canonicalCertification)
      .filter(Boolean) as string[];
    return {
      ...company,
      certifications: [...new Set([...company.certifications, ...certifications])],
    };
  }

  return { ...company, [suggestion.field]: suggestion.value_text };
}

// The certification a document proves, as a catalogue value (ENS carries its category).
export function extractionCertification(extraction: DocumentExtraction) {
  if (extraction.ens?.category) return `ENS_${extraction.ens.category}`;
  return extraction.credential_code
    ? canonicalCertification(extraction.credential_code)
    : undefined;
}

export function applyDocumentExtraction(
  company: CompanyProfile,
  extraction: DocumentExtraction,
) {
  const next = { ...company };
  const credential = extractionCertification(extraction);

  if (credential) {
    // A company holds one ENS category at a time.
    const others = isEnsLevel(credential)
      ? next.certifications.filter((value) => !isEnsLevel(value))
      : next.certifications;
    next.certifications = [...new Set([...others, credential])];
  }
  if (extraction.document_type?.toLowerCase().includes("rolece")) {
    next.rolece_status = "active";
    next.rolece_last_verified_at = new Date().toISOString();
  }
  if (extraction.rolece?.classifications.length) {
    next.classification_status = "active";
    next.classification_codes = extraction.rolece.classifications;
  }
  return next;
}

// Supabase row -> profile, filling the columns older rows lack.
export function companyFromRow(row: Record<string, unknown>): CompanyProfile {
  const data = row as Partial<CompanyProfile> & {
    rolece?: boolean;
    has_classification?: boolean;
  };
  return {
    ...EMPTY_COMPANY,
    ...data,
    name: data.name || "",
    nif: data.nif || "",
    website_url: data.website_url || "",
    description: data.description || "",
    cpv_prefixes: data.cpv_prefixes || [],
    keywords: data.keywords || [],
    regions: data.regions || [],
    certifications: data.certifications || [],
    rolece_status: data.rolece_status || (data.rolece ? "active" : "unknown"),
    classification_status:
      data.classification_status || (data.has_classification ? "active" : "unknown"),
    classification_codes: data.classification_codes || [],
  };
}

// Columns for a partial edit. Keeps the legacy booleans that match_tenders
// reads (rolece, has_classification) in step with the status fields.
export function companyPatchPayload(
  patch: Partial<CompanyProfile>,
  updatedAt: string,
) {
  const payload: Record<string, unknown> = { ...patch, updated_at: updatedAt };
  delete payload.id;
  delete payload.owner;
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.description !== undefined) payload.description = patch.description.trim();
  if (patch.nif !== undefined) payload.nif = patch.nif.trim() || null;
  if (patch.website_url !== undefined) {
    payload.website_url = patch.website_url.trim() || null;
  }
  if (patch.rolece_status !== undefined) {
    payload.rolece = patch.rolece_status === "active";
  }
  if (patch.classification_status !== undefined) {
    payload.has_classification = patch.classification_status === "active";
  }
  return payload;
}

export function companyWritePayload(company: CompanyProfile, updatedAt: string) {
  return {
    name: company.name.trim(),
    nif: company.nif.trim() || null,
    website_url: company.website_url.trim() || null,
    description: company.description.trim(),
    cpv_prefixes: company.cpv_prefixes,
    keywords: company.keywords,
    regions: company.regions,
    include_national: company.include_national,
    annual_turnover: company.annual_turnover,
    employees: company.employees,
    certifications: company.certifications,
    rolece_status: company.rolece_status,
    rolece: company.rolece_status === "active",
    rolece_last_verified_at: company.rolece_last_verified_at,
    classification_status: company.classification_status,
    has_classification: company.classification_status === "active",
    classification_codes: company.classification_codes,
    min_budget: company.min_budget,
    max_budget: company.max_budget,
    updated_at: updatedAt,
  };
}
