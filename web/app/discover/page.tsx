import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DiscoverFeed } from "@/components/discover/DiscoverFeed";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { TenderMatch } from "@/lib/types";

export const metadata = {
  title: "Discover",
};

type DiscoverPageProps = {
  searchParams: Promise<{ company?: string; onboarded?: string }>;
};

export default async function DiscoverPage({ searchParams }: DiscoverPageProps) {
  if (!isSupabaseConfigured()) redirect("/login");
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let companyQuery = supabase.from("companies").select("*");
  if (params.company) {
    companyQuery = companyQuery.eq("id", params.company);
  } else {
    companyQuery = companyQuery.eq("owner", user.id).order("created_at").limit(1);
  }
  let { data: companies } = await companyQuery;

  if (!companies?.length && !params.company) {
    const { data: demo } = await supabase
      .from("companies")
      .select("*")
      .eq("id", "00000000-0000-0000-0000-000000000001")
      .limit(1);
    companies = demo;
  }

  const company = companies?.[0];
  if (!company) redirect("/onboarding");

  const { data: matchRows, error } = await supabase.rpc("match_tenders", {
    p_company: company.id,
    p_limit: 50,
  });

  if (error) {
    throw new Error(`Could not load tender matches: ${error.message}`);
  }

  const rows = (matchRows || []) as TenderMatch[];
  const ids = rows.map((row) => row.tender_id);
  const sourceMap = new Map<string, "placsp" | "regional">();
  if (ids.length) {
    const { data: sources } = await supabase
      .from("tenders")
      .select("id,source")
      .in("id", ids);
    sources?.forEach((row) =>
      sourceMap.set(row.id, row.source === "regional" ? "regional" : "placsp"),
    );
  }

  const matches = rows.map((row) => ({
    ...row,
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    source: sourceMap.get(row.tender_id) || "placsp",
  }));

  const gaps = [
    !company.annual_turnover ? "turnover" : null,
    !(company.rolece_status === "active" || company.rolece) ? "ROLECE status" : null,
    !company.certifications?.length ? "certifications" : null,
  ].filter(Boolean);

  return (
    <AppShell
      active="discover"
      companyName={company.name}
      userEmail={user.email}
    >
      <main className="page-frame">
        <header className="page-header">
          <div>
            <p className="eyebrow">Friday · Updated daily</p>
            <h1>What&apos;s out there for you?</h1>
            <p>
              Ranked from your sector, services, regions, readiness and buyer
              competition.
            </p>
          </div>
          <a className="button button-secondary" href="/onboarding">
            Edit company profile
          </a>
        </header>

        {params.onboarded || gaps.length ? (
          <div className="notice notice-info" style={{ marginBottom: 16 }}>
            <strong>We found {matches.length} ranked open matches.</strong>
            {gaps.length ? (
              <span>
                Add {gaps.join(" and ")} to assess eligibility more accurately.
              </span>
            ) : (
              <span>Your essential profile information is ready.</span>
            )}
          </div>
        ) : null}

        <DiscoverFeed matches={matches} />
      </main>
    </AppShell>
  );
}
