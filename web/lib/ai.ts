import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

const DocumentExtractionSchema = z.object({
  document_type: z.string().nullable(),
  legal_entity_name: z.string().nullable(),
  nif: z.string().nullable(),
  credential_code: z.string().nullable(),
  credential_level: z.string().nullable(),
  standard_edition: z.string().nullable(),
  certificate_number: z.string().nullable(),
  issuer: z.string().nullable(),
  accreditation_body: z.string().nullable(),
  scope: z.string().nullable(),
  covered_sites: z.array(z.string()),
  issue_date: z.string().nullable(),
  expiry_date: z.string().nullable(),
  source_page: z.number().int().positive().nullable(),
  source_quote: z.string().nullable(),
  verified: z.boolean(),
  warnings: z.array(z.string()),
  rolece: z
    .object({
      artifact_type: z.enum(["signed_xml", "zip", "visual_pdf", "unknown"]),
      registry_status: z.string().nullable(),
      registration_or_application_date: z.string().nullable(),
      classifications: z.array(z.string()),
      represented_powers: z.array(z.string()),
    })
    .nullable(),
  ens: z
    .object({
      category: z.enum(["BASICA", "MEDIA", "ALTA"]).nullable(),
      evidence_type: z.enum(["declaration", "certification"]).nullable(),
      covered_systems_services: z.array(z.string()),
      renewal_date: z.string().nullable(),
    })
    .nullable(),
});

export function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the web server.");
  }
  // One retry at most: failed calls (e.g. no credits) shouldn't be repeated three times.
  return new OpenAI({ apiKey, maxRetries: 1 });
}

function model() {
  return process.env.OPENAI_MODEL || "gpt-4.1-mini";
}

type DocumentInput = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  extractedText?: string;
};

export async function extractCompanyDocument(input: DocumentInput) {
  const fileData = `data:${input.mimeType};base64,${input.bytes.toString("base64")}`;
  const content =
    input.mimeType === "application/pdf"
      ? [
          {
            type: "input_file" as const,
            filename: input.filename,
            file_data: fileData,
          },
          {
            type: "input_text" as const,
            text: "Extract the company credential metadata and one short verbatim citation supporting the core credential.",
          },
        ]
      : [
          {
            type: "input_text" as const,
            text:
              `File: ${input.filename}\n\n` +
              (input.extractedText || input.bytes.toString("utf8")).slice(0, 100_000),
          },
        ];

  const response = await getClient().responses.parse({
    model: model(),
    input: [
      {
        role: "system",
        content:
          "You extract reusable company evidence for Spanish public procurement. " +
          "Classify ROLECE, ENS, ISO and other credentials precisely. Copy dates and scope exactly. " +
          "ISO 27001 does not replace ENS. A ROLECE PDF is only a visual copy; signed XML/ZIP is the authoritative artifact. " +
          "If a field is absent, return null or an empty array. Never guess. " +
          "Set verified false; the application verifies citations deterministically after extraction.",
      },
      { role: "user", content },
    ],
    text: {
      format: zodTextFormat(DocumentExtractionSchema, "company_document_extraction"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("OpenAI returned no structured document extraction.");
  }
  return response.output_parsed;
}

export { DocumentExtractionSchema };
