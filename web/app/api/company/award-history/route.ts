import { NextResponse } from "next/server";
import { historySuggestions, summarizeAwards } from "@/lib/award-history";
import { loadCompanyAwards } from "@/lib/award-history-load";
import { companyFromRow } from "@/lib/profile";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET ?nif=…  The company's public award history and the profile facts it backs up.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const { data: row } = await supabase
    .from("companies")
    .select("*")
    .eq("owner", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Set up your company first." }, { status: 400 });
  const company = companyFromRow(row);

  const nif = new URL(request.url).searchParams.get("nif") || company.nif;
  const history = summarizeAwards(await loadCompanyAwards(supabase, nif));
  return NextResponse.json({ history, suggestions: historySuggestions(history, company) });
}
