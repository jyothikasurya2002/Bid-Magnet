import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { OnboardingForm } from "@/components/company/OnboardingForm";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { EMPTY_COMPANY, type CompanyProfile } from "@/lib/types";

export const metadata = {
  title: "Company profile",
};

export default async function OnboardingPage() {
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

  const initialCompany: CompanyProfile = data
    ? {
        ...EMPTY_COMPANY,
        ...data,
        nif: data.nif || "",
        website_url: data.website_url || "",
        description: data.description || "",
        cpv_prefixes: data.cpv_prefixes || [],
        keywords: data.keywords || [],
        regions: data.regions || [],
        certifications: data.certifications || [],
        rolece_status:
          data.rolece_status || (data.rolece ? "active" : "unknown"),
        classification_status:
          data.classification_status ||
          (data.has_classification ? "active" : "unknown"),
        classification_codes: data.classification_codes || [],
      }
    : EMPTY_COMPANY;

  return (
    <AppShell
      active="vault"
      companyName={initialCompany.name || "Company profile"}
      userEmail={user.email}
    >
      <main className="page-frame">
        <header className="page-header">
          <div>
            <p className="eyebrow">Vault · Company profile</p>
            <h1>Set up your company</h1>
            <p>
              Complete the essentials in a few minutes. Add evidence when it
              improves a specific tender assessment.
            </p>
          </div>
        </header>
        <OnboardingForm initialCompany={initialCompany} userId={user.id} />
      </main>
    </AppShell>
  );
}
