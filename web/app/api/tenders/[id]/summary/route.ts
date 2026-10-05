import { NextResponse } from "next/server";
import { summarizeTender } from "@/lib/tender-summary";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_request: Request, ctx: RouteContext<"/api/tenders/[id]/summary">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const { id } = await ctx.params;
  const [tender, criteria, requirements, extraction] = await Promise.all([
    supabase
      .from("tenders")
      .select(
        "id,title,buyer_name,buyer_city,region,status_label,contract_type_label,procedure_label,budget_no_tax,estimated_value,cpv_codes,duration,duration_unit,deadline_date,deadline_time,has_lots,lots,updated,extra",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("tender_criteria").select("lot_id,type,description,weight").eq("tender_id", id),
    supabase.from("tender_requirements").select("lot_id,kind,description,threshold").eq("tender_id", id),
    supabase
      .from("tender_extractions")
      .select("output")
      .eq("tender_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!tender.data) return NextResponse.json({ error: "Tender not found." }, { status: 404 });

  try {
    const summary = await summarizeTender(`${id}:${tender.data.updated}`, {
      tender: tender.data,
      criteria: criteria.data || [],
      requirements: requirements.data || [],
      checklist: (extraction.data?.output as Record<string, unknown>) || null,
    });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("tender summary failed", error);
    const message = error instanceof Error ? error.message : "unknown error";
    const friendly = /credit|quota|billing|429/i.test(message)
      ? "AI summary unavailable: the OpenAI account has run out of credits."
      : "Couldn't write the summary right now. Try again in a minute.";
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
