import { redirect } from "next/navigation";
import { companyFromRow } from "./profile";
import { createClient, isSupabaseConfigured } from "./supabase/server";

// The signed-in user and their company, or a redirect to login / onboarding.
export async function requireCompany() {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: companyRow } = await supabase
    .from("companies")
    .select("*")
    .eq("owner", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!companyRow) redirect("/welcome");
  return { supabase, user, company: companyFromRow(companyRow) };
}
