import { NextResponse } from "next/server";
import { companyFromRow } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";
import { streamTenderChat, type ChatEvent, type ChatTurn } from "@/lib/tender-chat";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatRequest = { message?: unknown; previousId?: unknown; history?: unknown };

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

  const { id } = await ctx.params;
  const [tender, criteria, requirements, extraction, documents, companyRow] = await Promise.all([
    supabase
      .from("tenders")
      .select(
        "id,title,buyer_name,buyer_nif,buyer_city,region,status_label,contract_type_label,procedure_label,budget_no_tax,estimated_value,cpv_codes,duration,duration_unit,deadline_date,deadline_time,has_lots,lots,link,extra",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("tender_criteria").select("lot_id,type,description,weight").eq("tender_id", id),
    supabase.from("tender_requirements").select("lot_id,kind,code,description,threshold").eq("tender_id", id),
    supabase
      .from("tender_extractions")
      .select("output")
      .eq("tender_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("tender_documents").select("kind,name,url").eq("tender_id", id),
    supabase.from("companies").select("*").eq("owner", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (!tender.data) return NextResponse.json({ error: "Tender not found." }, { status: 404 });
  if (!companyRow.data) return NextResponse.json({ error: "Set up your company first." }, { status: 400 });

  const buyer = tender.data.buyer_nif
    ? (await supabase.from("buyer_stats").select("*").eq("buyer_nif", tender.data.buyer_nif).maybeSingle()).data
    : null;
  const company = companyFromRow(companyRow.data);

  const events = streamTenderChat({
    question: message,
    previousId,
    history,
    context: {
      tender: tender.data,
      criteria: criteria.data || [],
      requirements: requirements.data || [],
      checklist: (extraction.data?.output as Record<string, unknown>) || null,
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
      documents: documents.data || [],
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
