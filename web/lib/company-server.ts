import { cache } from "react";
import { redirect } from "next/navigation";
import { companyFromRow } from "./profile";
import { createClient, isSupabaseConfigured } from "./supabase/server";

// The signed-in user and their company, or a redirect to login / onboarding. Once per
// request: getClaims checks the session token's signature locally instead of calling
// the auth server on every page load.
export const requireCompany = cache(async () => {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const sub = claims?.claims?.sub;
  if (!sub) redirect("/login");
  const user = { id: sub, email: typeof claims.claims.email === "string" ? claims.claims.email : undefined };

  const { data: companyRow } = await supabase
    .from("companies")
    .select("*")
    .eq("owner", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!companyRow) redirect("/welcome");
  return { supabase, user, company: companyFromRow(companyRow) };
});

// "migo.chapero@gmail.com" -> "Migo Chapero": how you appear on tasks you take.
export function displayName(email: string | undefined) {
  const local = (email || "").split("@")[0];
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
  return name || "You";
}
