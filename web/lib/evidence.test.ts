import { describe, expect, it } from "vitest";
import { proofFor, validity } from "./evidence";
import type { CompanyDocument, DocumentExtraction } from "./types";

const extraction = (change: Partial<DocumentExtraction>): DocumentExtraction => ({
  document_type: null,
  legal_entity_name: null,
  nif: null,
  credential_code: null,
  credential_level: null,
  standard_edition: null,
  certificate_number: null,
  issuer: null,
  accreditation_body: null,
  scope: null,
  covered_sites: [],
  issue_date: null,
  expiry_date: null,
  source_page: null,
  source_quote: null,
  verified: true,
  warnings: [],
  rolece: null,
  ens: null,
  ...change,
});

const doc = (id: string, status: CompanyDocument["processing_status"], x: DocumentExtraction) =>
  ({
    id,
    processing_status: status,
    extraction: x,
    document_type: x.document_type || "other",
    created_at: `2026-0${id}-01T00:00:00Z`,
  }) as CompanyDocument;

describe("document proof", () => {
  it("links only confirmed documents, newest first", () => {
    const docs = [
      doc("1", "ready", extraction({ credential_code: "ISO 9001" })),
      doc("2", "ready", extraction({ credential_code: "ISO 9001:2015" })),
      doc("3", "needs_review", extraction({ credential_code: "ISO 9001" })),
    ];
    expect(proofFor("cert:ISO9001", docs)?.id).toBe("2");
    expect(proofFor("cert:ISO27001", docs)).toBeUndefined();
  });

  it("groups every ENS category under one fact", () => {
    const docs = [doc("1", "ready", extraction({ ens: { category: "ALTA", evidence_type: null, covered_systems_services: [], renewal_date: null } }))];
    expect(proofFor("cert:ENS", docs)?.id).toBe("1");
  });

  it("describes expiry relative to today", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    expect(validity("2027-03-31", now)).toEqual({ tone: "good", label: "Valid to Mar 2027" });
    expect(validity("2026-11-14", now)).toEqual({ tone: "warn", label: "Expires in 6 weeks" });
    expect(validity("2026-09-01", now).label).toBe("Expired Sep 2026");
    expect(validity(null, now)).toEqual({ tone: "good", label: "Verified" });
  });
});
