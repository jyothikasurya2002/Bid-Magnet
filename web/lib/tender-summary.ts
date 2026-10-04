import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getClient } from "./ai";

// Plain-English brief of a tender for the Discover preview pane and swipe cards.
// Built only from data we hold (the notice, its criteria and requirements, and the
// cited checklist when one exists); it never reads the PDFs itself.

export const TenderSummarySchema = z.object({
  summary: z.string(),
  scope: z.array(z.string()),
  watch_outs: z.array(z.string()),
});

export type TenderSummary = z.infer<typeof TenderSummarySchema> & {
  basis: "notice" | "checklist";
};

export type TenderSummaryInput = {
  tender: Record<string, unknown>;
  criteria: Array<Record<string, unknown>>;
  requirements: Array<Record<string, unknown>>;
  checklist: Record<string, unknown> | null;
};

const INSTRUCTIONS = `You brief a small Spanish IT company deciding whether to bid on a public tender.
Write in plain English for a founder, not a procurement expert. Use only the data provided; never guess numbers, dates or requirements that are not there. Translate Spanish terms, but keep official names (buyer, ENS, ROLECE) as written.
- summary: 2-3 sentences: what the buyer wants built or run, for whom, and for how long.
- scope: up to 4 short bullets of the concrete work or deliverables.
- watch_outs: up to 3 short bullets on what could make bidding hard or risky (solvency thresholds, certifications, classification, short deadline, criteria weighted to judgement, many lots). Empty if nothing stands out.`;

const cache = new Map<string, TenderSummary>();

export async function summarizeTender(key: string, input: TenderSummaryInput): Promise<TenderSummary> {
  const cached = cache.get(key);
  if (cached) return cached;

  // Drop the checklist's internal metadata; keep it compact.
  const checklist = input.checklist
    ? Object.fromEntries(Object.entries(input.checklist).filter(([name]) => !name.startsWith("_")))
    : null;
  const payload = JSON.stringify({ ...input, checklist }).slice(0, 60_000);

  const response = await getClient().responses.parse({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: INSTRUCTIONS,
    input: payload,
    text: { format: zodTextFormat(TenderSummarySchema, "tender_summary") },
  });
  if (!response.output_parsed) throw new Error("The summary came back empty.");

  const summary: TenderSummary = { ...response.output_parsed, basis: checklist ? "checklist" : "notice" };
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(key, summary);
  return summary;
}
