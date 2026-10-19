import type { ResponseInputItem, ResponseStreamEvent } from "openai/resources/responses/responses";
import { getClient } from "./ai";
import { fetchPdf } from "./crawler";

// "Ask about this tender": a chat grounded in the tender's own PDFs (admin terms and
// technical specs), the data we hold about it, and the company's profile.

export type ChatDocument = { kind: string; name: string; url: string };

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type ChatEvent =
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; response_id: string; documents?: ChatDocument[] }
  | { type: "error"; message: string };

export type ChatTopic = { title: string; context: string };

export type ChatContext = {
  tender: Record<string, unknown>;
  criteria: Array<Record<string, unknown>>;
  requirements: Array<Record<string, unknown>>;
  checklist: Record<string, unknown> | null;
  buyer: Record<string, unknown> | null;
  company: Record<string, unknown>;
  documents: ChatDocument[];
};

export const DOC_LABEL: Record<string, string> = {
  pcap: "PCAP",
  ppt: "PPT",
};

const INSTRUCTIONS = `You are Scout, BidMagnet's assistant. You help a small Spanish IT company understand one public tender and decide whether and how to bid.
You have the tender's own documents (PCAP = administrative terms, PPT = technical specifications, when attached), the structured notice data, buyer statistics and the company's profile.

Rules:
- Answer in the language the user writes in. Be short and concrete: lead with the answer, then the detail that matters. Use bullets for lists.
- Ground every factual claim about the tender in the documents or data. When it comes from a PDF, cite it as [PCAP p.12] or [PPT p.4] (the page number of the PDF), and for anything decisive add the exact Spanish wording on its own line as a quote starting with "> ".
- If the documents don't say, say so plainly and suggest where to check (e.g. the official notice or the buyer's clarifications). Never invent figures, dates, thresholds or requirements.
- When asked whether the company qualifies, compare the requirement with the company profile and say what is met, what is missing and what to do about it.
- No preamble, no closing offers of further help.`;

function model() {
  return process.env.OPENAI_CHAT_MODEL || "gpt-6.1-sol";
}

// The admin terms and the technical specs, when the platform lists them.
function pickDocuments(documents: ChatDocument[]) {
  return ["pcap", "ppt"]
    .map((kind) => documents.find((doc) => doc.kind === kind))
    .filter((doc): doc is ChatDocument => Boolean(doc));
}

function compactChecklist(checklist: Record<string, unknown> | null) {
  return checklist ? Object.fromEntries(Object.entries(checklist).filter(([name]) => !name.startsWith("_"))) : null;
}

async function* openingInput(context: ChatContext, question: string, history: ChatTurn[], topic: ChatTopic | null) {
  const documents = pickDocuments(context.documents);
  const files: Array<{ type: "input_file"; filename: string; file_data: string }> = [];
  const read: ChatDocument[] = [];
  for (const doc of documents) {
    yield { type: "status", text: `Reading the ${doc.kind === "pcap" ? "administrative terms" : "technical specs"}…` } as ChatEvent;
    try {
      const bytes = await fetchPdf(doc.url);
      files.push({
        type: "input_file",
        filename: `${DOC_LABEL[doc.kind]}.pdf`,
        file_data: `data:application/pdf;base64,${bytes.toString("base64")}`,
      });
      read.push(doc);
    } catch (error) {
      console.warn("tender chat: could not fetch", doc.kind, error);
    }
  }

  const data = JSON.stringify({ ...context, checklist: compactChecklist(context.checklist), documents: undefined }).slice(0, 80_000);
  const missing = documents.length > read.length || !documents.length;
  const transcript = history.length
    ? `Earlier in this conversation:\n${history.map((turn) => `${turn.role === "user" ? "User" : "You"}: ${turn.text}`).join("\n\n")}\n\n`
    : "";

  const input: ResponseInputItem[] = [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: `Tender data (JSON):\n${data}\n\nAttached documents: ${read.map((doc) => `${DOC_LABEL[doc.kind]}.pdf (${doc.name})`).join(", ") || "none"}.${
            missing ? " Some tender documents could not be read; say so if the answer depends on them." : ""
          }`,
        },
        ...files,
        {
          type: "input_text",
          text: `${
            topic ? `This conversation is about one part of the bid: ${topic.title}.\n${topic.context}\nKeep answers focused on it.\n\n` : ""
          }${transcript}Question: ${question}`,
        },
      ],
    },
  ];
  return { input, read };
}

// Streams the answer. The first turn attaches the PDFs; later turns continue the stored
// conversation, falling back to a fresh one (with the transcript) if it has expired.
export async function* streamTenderChat(options: {
  context: ChatContext;
  question: string;
  previousId: string | null;
  history: ChatTurn[];
  topic?: ChatTopic | null;
}): AsyncGenerator<ChatEvent> {
  const client = getClient();
  let previousId = options.previousId;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let input: string | ResponseInputItem[] = options.question;
    let read: ChatDocument[] | undefined;
    if (!previousId) {
      const opening = openingInput(options.context, options.question, options.history, options.topic ?? null);
      let step = await opening.next();
      while (!step.done) {
        yield step.value;
        step = await opening.next();
      }
      input = step.value.input;
      read = step.value.read;
      yield { type: "status", text: "Thinking…" };
    }

    try {
      const stream = (await client.responses.create({
        model: model(),
        instructions: INSTRUCTIONS,
        input,
        previous_response_id: previousId ?? undefined,
        store: true,
        stream: true,
      })) as AsyncIterable<ResponseStreamEvent>;

      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { type: "delta", text: event.delta };
        } else if (event.type === "response.completed") {
          yield { type: "done", response_id: event.response.id, documents: read };
          return;
        } else if (event.type === "response.failed") {
          yield { type: "error", message: event.response.error?.message || "The answer failed." };
          return;
        } else if (event.type === "error") {
          yield { type: "error", message: event.message };
          return;
        }
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (previousId && attempt === 0 && /previous[_ ]response/i.test(message)) {
        previousId = null; // expired: start over with the transcript
        continue;
      }
      yield { type: "error", message };
      return;
    }
  }
}
