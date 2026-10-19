import { NextResponse } from "next/server";
import { buyerStats, tenderBundle } from "@/lib/data-cache";
import { companyFromRow } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { streamTenderChat, type ChatEvent, type ChatTurn } from "@/lib/tender-chat";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatRequest = { message?: unknown; previousId?: unknown; history?: unknown; topic?: unknown };

export async function POST(request: Request, ctx: RouteContext<"/api/tenders/[id]/chat">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as ChatRequest;
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 4000) : "";
  if (!message) return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
  const previousId = typeof body.previousId === "string" && body.previousId ? body.previousId : null;
  const history: ChatTurn[] = Array.isArray(body.history)
    ? body.history
        .filter(
          (turn): turn is ChatTurn =>
            Boolean(turn) && (turn.role === "user" || turn.role === "assistant") && typeof turn.text === "string",
        )
        .slice(-12)
        .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 4000) }))
    : [];

  // The part of the bid this thread is about (a task in the plan), if any.
  const topic =
    body.topic && typeof body.topic === "object" && typeof (body.topic as { title?: unknown }).title === "string"
      ? {
          title: String((body.topic as { title: string }).title).slice(0, 300),
          context: String((body.topic as { context?: unknown }).context ?? "").slice(0, 4000),
        }
      : null;

  const { id } = await ctx.params;
  const [bundle, companyRow] = await Promise.all([
    tenderBundle(supabase, id),
    supabase.from("companies").select("*").eq("owner", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (!bundle.tender) return NextResponse.json({ error: "Tender not found." }, { status: 404 });
  if (!companyRow.data) return NextResponse.json({ error: "Set up your company first." }, { status: 400 });

  const buyer = await buyerStats<Record<string, unknown>>(supabase, bundle.tender.buyer_nif);
  const company = companyFromRow(companyRow.data);

  const events = streamTenderChat({
    question: message,
    previousId,
    history,
    topic,
    context: {
      tender: bundle.tender,
      criteria: bundle.criteria,
      requirements: bundle.requirements,
      checklist: bundle.checklist,
      buyer,
      company: {
        name: company.name,
        description: company.description,
        sectors: company.cpv_prefixes,
        keywords: company.keywords,
        regions: company.regions,
        annual_turnover: company.annual_turnover,
        employees: company.employees,
        certifications: company.certifications,
        rolece_status: company.rolece_status,
        classification_status: company.classification_status,
        classification_codes: company.classification_codes,
      },
      documents: bundle.documents,
    },
  });

  // One JSON event per line.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) return controller.close();
        controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (error) {
        console.error("tender chat failed", error);
        const event: ChatEvent = { type: "error", message: error instanceof Error ? error.message : "unknown error" };
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
