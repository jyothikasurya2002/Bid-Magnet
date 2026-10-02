import { describe, expect, it } from "vitest";
import {
  applyDocumentExtraction,
  applyImportSuggestion,
  companyWritePayload,
  validateCompanyProfile,
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
      source_quote: "Cloud and municipal software",
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

  it("requires identity, description and matching inputs", () => {
    expect(validateCompanyProfile(EMPTY_COMPANY)).toHaveLength(3);
  });
});
