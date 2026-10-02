import { CERTIFICATIONS, REGIONS } from "./catalog";
import type {
  CompanyProfile,
  DocumentExtraction,
  ImportSuggestion,
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

export function applyDocumentExtraction(
  company: CompanyProfile,
  extraction: DocumentExtraction,
) {
  const next = { ...company };
  const credential = extraction.credential_code
    ? canonicalCertification(extraction.credential_code)
    : undefined;

  if (credential) {
    next.certifications = [...new Set([...next.certifications, credential])];
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

export function validateCompanyProfile(company: CompanyProfile) {
  const errors: string[] = [];
  if (!company.name.trim()) errors.push("Enter the legal company name.");
  if (!company.description.trim()) {
    errors.push("Describe the services your company provides.");
  }
  if (!company.cpv_prefixes.length && !company.keywords.length) {
    errors.push("Add at least one CPV code or service keyword.");
  }
  return errors;
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
