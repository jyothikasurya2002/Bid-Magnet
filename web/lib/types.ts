export type RoleceStatus =
  | "unknown"
  | "applied"
  | "active"
  | "not_registered"
  | "needs_update";

export type ClassificationStatus =
  | "unknown"
  | "active"
  | "not_held"
  | "needs_update";

export type CompanyProfile = {
  id?: string;
  owner?: string | null;
  name: string;
  nif: string;
  website_url: string;
  description: string;
  cpv_prefixes: string[];
  keywords: string[];
  regions: string[];
  include_national: boolean;
  annual_turnover: number | null;
  employees: number | null;
  certifications: string[];
  rolece_status: RoleceStatus;
  rolece_last_verified_at: string | null;
  classification_status: ClassificationStatus;
  classification_codes: string[];
  min_budget: number | null;
  max_budget: number | null;
  updated_at?: string;
};

export type EvidenceState =
  | "direct_source"
  | "inferred"
  | "needs_judgement"
  | "conflict"
  | "no_evidence";

export type ImportSuggestion = {
  field:
    | "name"
    | "nif"
    | "description"
    | "website_url"
    | "keywords"
    | "cpv_prefixes"
    | "regions"
    | "certifications";
  value_text: string;
  values: string[];
  evidence_state: EvidenceState;
  source_url: string;
  source_title: string;
  source_quote: string;
  explanation: string;
  // true when we re-opened source_url and found source_quote on it
  verified: boolean;
};

export type ResearchSource = { url: string; title: string; cited: boolean };

export type ImportResult = {
  canonical_url: string;
  legal_name: string | null;
  ambiguous: boolean;
  sources: ResearchSource[];
  not_found: string[];
  suggestions: ImportSuggestion[];
};

export type ResearchPoll =
  | { status: "running" }
  | { status: "failed"; error: string }
  | { status: "done"; result: ImportResult };

export type MatchReason = {
  type: "ok" | "warn" | "gap";
  points: number;
  text: string;
};

export type TenderMatch = {
  tender_id: string;
  title: string;
  buyer_name: string | null;
  region: string | null;
  budget_no_tax: number | null;
  deadline_date: string | null;
  days_left: number | null;
  procedure_label: string | null;
  it_segment: string | null;
  score: number;
  reasons: MatchReason[];
  has_checklist: boolean;
  link: string | null;
  source?: "placsp" | "regional" | null;
};

export type DocumentProcessingStatus =
  | "uploaded"
  | "extracting"
  | "needs_review"
  | "ready"
  | "failed";

export type DocumentExtraction = {
  document_type: string | null;
  legal_entity_name: string | null;
  nif: string | null;
  credential_code: string | null;
  credential_level: string | null;
  standard_edition: string | null;
  certificate_number: string | null;
  issuer: string | null;
  accreditation_body: string | null;
  scope: string | null;
  covered_sites: string[];
  issue_date: string | null;
  expiry_date: string | null;
  source_page: number | null;
  source_quote: string | null;
  verified: boolean;
  warnings: string[];
  rolece?: {
    artifact_type: "signed_xml" | "zip" | "visual_pdf" | "unknown";
    registry_status: string | null;
    registration_or_application_date: string | null;
    classifications: string[];
    represented_powers: string[];
  } | null;
  ens?: {
    category: "BASICA" | "MEDIA" | "ALTA" | null;
    evidence_type: "declaration" | "certification" | null;
    covered_systems_services: string[];
    renewal_date: string | null;
  } | null;
};

export type CompanyDocument = {
  id: string;
  company_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  document_type: string;
  processing_status: DocumentProcessingStatus;
  extraction: DocumentExtraction | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export const EMPTY_COMPANY: CompanyProfile = {
  name: "",
  nif: "",
  website_url: "",
  description: "",
  cpv_prefixes: [],
  keywords: [],
  regions: [],
  include_national: true,
  annual_turnover: null,
  employees: null,
  certifications: [],
  rolece_status: "unknown",
  rolece_last_verified_at: null,
  classification_status: "unknown",
  classification_codes: [],
  min_budget: null,
  max_budget: null,
};
