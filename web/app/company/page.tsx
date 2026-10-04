import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CompanyLedger } from "@/components/company/CompanyLedger";
import { companyFromRow } from "@/lib/profile";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { CompanyDocument } from "@/lib/types";

export const metadata = {
  title: "Company",
};

export default async function Page() {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("companies")
    .select("*")
    .eq("owner", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // New users start on the welcome page, which creates the company and researches it.
  if (!data) redirect("/welcome");
  const company = companyFromRow(data);

  const { data: rows } = await supabase
    .from("company_documents")
    .select("*")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false });

  return (
    <AppShell active="company" companyName={company.name} userEmail={user.email}>
      <CompanyLedger
        initialCompany={company}
        initialDocuments={(rows || []) as CompanyDocument[]}
        userId={user.id}
      />
    </AppShell>
  );
}
