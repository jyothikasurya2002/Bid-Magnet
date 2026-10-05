import { describe, expect, it } from "vitest";
import {
  applyDocumentExtraction,
  applyImportSuggestion,
  companyWritePayload,
  companyFromRow,
  companyPatchPayload,
} from "./profile";
import { EMPTY_COMPANY, type DocumentExtraction } from "./types";

describe("company profile mapping", () => {
  it("maps sourced website values without duplicating arrays", () => {
    const company = { ...EMPTY_COMPANY, keywords: ["cloud"] };
    const result = applyImportSuggestion(company, {
      field: "keywords",
      value_text: "",
      values: ["cloud", "municipal software"],
      evidence_state: "direct_source",
      source_url: "https://example.es/services",
      source_title: "Services",
      source_quote: "Cloud and municipal software",
      verified: true,
      explanation: "Explicitly listed services",
    });
    expect(result.keywords).toEqual(["cloud", "municipal software"]);
  });

  it("maps reviewed credentials into canonical profile fields", () => {
    const extraction: DocumentExtraction = {
      document_type: "ROLECE certificate",
      legal_entity_name: "Example S.L.",
      nif: "B12345678",
      credential_code: "ISO/IEC 27001",
      credential_level: null,
      standard_edition: "2022",
      certificate_number: "1",
      issuer: "AENOR",
      accreditation_body: "ENAC",
      scope: "Cloud services",
      covered_sites: [],
      issue_date: null,
      expiry_date: null,
      source_page: 1,
      source_quote: "ISO/IEC 27001",
      verified: true,
      warnings: [],
      rolece: {
        artifact_type: "visual_pdf",
        registry_status: "active",
        registration_or_application_date: null,
        classifications: ["V-2-3"],
        represented_powers: [],
      },
      ens: null,
    };
    const result = applyDocumentExtraction(EMPTY_COMPANY, extraction);
    expect(result.certifications).toContain("ISO27001");
    expect(result.rolece_status).toBe("active");
    expect(result.classification_codes).toEqual(["V-2-3"]);
  });

  it("keeps legacy booleans aligned in the write payload", () => {
    const company = {
      ...EMPTY_COMPANY,
      name: "Example",
      description: "Cloud services",
      keywords: ["cloud"],
      rolece_status: "active" as const,
      classification_status: "active" as const,
    };
    const payload = companyWritePayload(company, "2026-10-02T20:00:00Z");
    expect(payload.rolece).toBe(true);
    expect(payload.has_classification).toBe(true);
  });

  it("maps an ENS certificate to a single ENS category", () => {
    const extraction: DocumentExtraction = {
      document_type: "ENS certificate",
      legal_entity_name: null,
      nif: null,
      credential_code: "ENS",
      credential_level: "MEDIA",
      standard_edition: null,
      certificate_number: null,
      issuer: null,
      accreditation_body: null,
      scope: null,
      covered_sites: [],
      issue_date: null,
      expiry_date: "2027-03-01",
      source_page: 1,
      source_quote: null,
      verified: false,
      warnings: [],
      rolece: null,
      ens: {
        category: "MEDIA",
        evidence_type: "certification",
        covered_systems_services: [],
        renewal_date: null,
      },
    };
    const company = { ...EMPTY_COMPANY, certifications: ["ENS_BASICA", "ISO9001"] };
    const result = applyDocumentExtraction(company, extraction);
    expect(result.certifications).toEqual(["ISO9001", "ENS_MEDIA"]);
  });

  it("writes only the edited fields and their legacy booleans", () => {
    const payload = companyPatchPayload(
      { rolece_status: "applied", nif: "  " },
      "2026-10-03T08:00:00Z",
    );
    expect(payload).toEqual({
      rolece_status: "applied",
      rolece: false,
      nif: null,
      updated_at: "2026-10-03T08:00:00Z",
    });
  });

  it("reads legacy rows that only have the boolean flags", () => {
    const company = companyFromRow({ name: "Demo", rolece: true, has_classification: false });
    expect(company.rolece_status).toBe("active");
    expect(company.classification_status).toBe("unknown");
    expect(company.cpv_prefixes).toEqual([]);
  });
});
