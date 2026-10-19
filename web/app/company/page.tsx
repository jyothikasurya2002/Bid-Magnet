import { AppShell } from "@/components/AppShell";
import { CompanyLedger } from "@/components/company/CompanyLedger";
import { requireCompany } from "@/lib/company-server";
import type { CompanyDocument } from "@/lib/types";

export const metadata = {
  title: "Company",
};

export default async function Page() {
  // New users are sent to the welcome page, which creates the company and researches it.
  const { supabase, user, company } = await requireCompany();

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
