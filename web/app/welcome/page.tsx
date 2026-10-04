import { redirect } from "next/navigation";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { companyFromRow } from "@/lib/profile";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { CompanyDocument } from "@/lib/types";

export const metadata = {
  title: "Welcome",
};

export default async function WelcomePage() {
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

  let documents: CompanyDocument[] = [];
  if (data) {
    const { data: rows } = await supabase
      .from("company_documents")
      .select("*")
      .eq("company_id", data.id)
      .order("created_at", { ascending: false });
    documents = (rows || []) as CompanyDocument[];
  }

  return (
    <Onboarding initialCompany={data ? companyFromRow(data) : null} initialDocuments={documents} userId={user.id} />
  );
}
