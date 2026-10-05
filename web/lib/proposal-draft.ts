import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getClient } from "./ai";
import type { ProposalOutline } from "./draft-outline";

// AI first draft of the technical proposal, written section by section on the outline from
// draft-outline.ts. It may only use facts we hold (tender data, checklist, company profile);
// anything else stays as an [ADD: …] placeholder so nobody submits invented claims.

export const ProposalDraftSchema = z.object({
  sections: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      text: z.string(),
      placeholders: z.array(z.string()),
    }),
  ),
  cautions: z.array(z.string()),
});

export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;

export type ProposalDraftInput = {
  tender: Record<string, unknown>;
  outline: ProposalOutline;
  checklist: Record<string, unknown> | null;
  company: Record<string, unknown>;
  language: "es" | "en";
};

const INSTRUCTIONS = `You draft the technical proposal ("memoria técnica") of a small Spanish IT company for a public tender.
Follow the outline exactly: one section per outline section, same key and title, in the same order.
For each section write the text the evaluators will read, aimed at the criterion's points and how it is scored.
Hard rules:
- Use ONLY facts in the company profile and tender data. Never invent clients, projects, figures, team members, certificates or dates.
- Where a fact is needed and missing, write a placeholder in the text like [ADD: number of certified engineers] and list it in placeholders.
- For criteria scored by formula, write the commitment sentence with an [ADD: …] for the value: the company decides it.
- Be specific to this buyer and scope; no generic marketing language. 120-250 words per judgement section, 30-80 for the others.
- cautions: up to 4 short notes on risks the team must check (e.g. page limits, envelope rules: judgement content must never reveal the price).`;

const cache = new Map<string, ProposalDraft>();

export async function draftProposal(key: string, input: ProposalDraftInput): Promise<ProposalDraft> {
  const cached = cache.get(key);
  if (cached) return cached;

  const checklist = input.checklist
    ? Object.fromEntries(Object.entries(input.checklist).filter(([name]) => !name.startsWith("_")))
    : null;
  const payload = JSON.stringify({ ...input, checklist }).slice(0, 60_000);
  const language = input.language === "es" ? "Write in Spanish (Spain)." : "Write in English.";

  const response = await getClient().responses.parse({
    model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions: `${INSTRUCTIONS}\n${language}`,
    input: payload,
    text: { format: zodTextFormat(ProposalDraftSchema, "proposal_draft") },
  });
  if (!response.output_parsed) throw new Error("The draft came back empty.");

  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  cache.set(key, response.output_parsed);
  return response.output_parsed;
}
