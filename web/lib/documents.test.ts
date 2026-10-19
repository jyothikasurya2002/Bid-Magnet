import { describe, expect, it } from "vitest";
import { normalizeEvidence, verifyDocumentCitation } from "./documents";
import type { DocumentExtraction } from "./types";

const extraction: DocumentExtraction = {
  document_type: "ISO certificate",
  legal_entity_name: "Example S.L.",
  nif: "B12345678",
  credential_code: "ISO27001",
  credential_level: null,
  standard_edition: "2022",
  certificate_number: "CERT-1",
  issuer: "Example Certifier",
  accreditation_body: null,
  scope: "Cloud hosting",
  covered_sites: [],
  issue_date: "2026-01-01",
  expiry_date: "2029-01-01",
  source_page: 2,
  source_quote: "Sistema de gestión de seguridad de la información certificado",
  verified: false,
  warnings: [],
  rolece: null,
  ens: null,
};

describe("document evidence verification", () => {
  it("normalizes accents and punctuation", () => {
    expect(normalizeEvidence("Gestión — Información")).toBe("gestion informacion");
  });

  it("verifies a quote on the cited page", () => {
    const result = verifyDocumentCitation(extraction, [
      "Cover",
      "Sistema de gestión de seguridad de la información certificado para servicios cloud.",
    ]);
    expect(result.verified).toBe(true);
    expect(result.source_page).toBe(2);
  });

  it("flags unsupported citations", () => {
    const result = verifyDocumentCitation(extraction, ["Cover", "Different content"]);
    expect(result.verified).toBe(false);
    expect(result.warnings).toContain(
      "The cited quote could not be verified against the extracted document text.",
    );
  });
});
