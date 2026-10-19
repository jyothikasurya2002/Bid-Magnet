import { NextResponse } from "next/server";
import { loadBidPrep } from "@/lib/bid-prep-server";
import { companyFromRow } from "@/lib/profile";
import { draftProposal } from "@/lib/proposal-draft";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST { language?: "es" | "en" } → AI first draft of the technical proposal.
export async function POST(request: Request, ctx: RouteContext<"/api/tenders/[id]/draft">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { language?: string };
  const language = body.language === "en" ? "en" : "es";

  const [{ data: companyRow }, extraction] = await Promise.all([
    supabase.from("companies").select("*").eq("owner", user.id).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("tender_extractions").select("output").eq("tender_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!companyRow) return NextResponse.json({ error: "Set up your company first." }, { status: 400 });
  const company = companyFromRow(companyRow);

  const prep = await loadBidPrep(supabase, id, company);
  if (!prep) return NextResponse.json({ error: "Tender not found." }, { status: 404 });

  try {
    const draft = await draftProposal(`${id}:${company.id}:${company.updated_at}:${language}`, {
      tender: prep.tender,
      outline: prep.outline,
      checklist: (extraction.data?.output as Record<string, unknown>) || null,
      company: {
        name: company.name,
        description: company.description,
        keywords: company.keywords,
        regions: company.regions,
        employees: company.employees,
        annual_turnover: company.annual_turnover,
        certifications: company.certifications,
        rolece_status: company.rolece_status,
        classification_codes: company.classification_codes,
      },
      language,
    });
    return NextResponse.json(draft);
  } catch (error) {
    console.error("proposal draft failed", error);
    const message = error instanceof Error ? error.message : "unknown error";
    const friendly = /OPENAI_API_KEY/.test(message)
      ? "AI draft unavailable: no OpenAI key is configured. The outline above still works."
      : /credit|quota|billing|429/i.test(message)
        ? "AI draft unavailable: the OpenAI account has run out of credits."
        : "Couldn't write the draft right now. Try again in a minute.";
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
