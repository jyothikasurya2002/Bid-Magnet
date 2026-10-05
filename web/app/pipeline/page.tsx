import { AppShell } from "@/components/AppShell";
import { PipelineList, type PipelineItem } from "@/components/pipeline/PipelineList";
import { requireCompany } from "@/lib/company-server";
import type { Decision } from "@/lib/discover";
import type { MatchReason } from "@/lib/types";

export const metadata = {
  title: "Pipeline",
};

type TenderRow = {
  id: string;
  title: string;
  buyer_name: string | null;
  budget_no_tax: number | string | null;
  deadline_date: string | null;
  deadline_time: string | null;
};

export default async function PipelinePage() {
  const { supabase, user, company } = await requireCompany();

  const [decisions, matches] = await Promise.all([
    supabase
      .from("tender_decisions")
      .select("tender_id,decision,decided_at")
      .eq("company_id", company.id)
      .in("decision", ["go", "watch"]),
    supabase.rpc("match_tenders", { p_company: company.id, p_limit: 2000 }),
  ]);
  const rows = (decisions.data || []) as Array<{ tender_id: string; decision: Decision; decided_at: string }>;
  const tenders = rows.length
    ? (
        await supabase
          .from("tenders")
          .select("id,title,buyer_name,budget_no_tax,deadline_date,deadline_time")
          .in(
            "id",
            rows.map((row) => row.tender_id),
          )
      ).data || []
    : [];
  const byId = new Map((tenders as TenderRow[]).map((row) => [row.id, row]));
  const scores = new Map(
    ((matches.data || []) as Array<{ tender_id: string; score: number; reasons: MatchReason[] }>).map((row) => [row.tender_id, row]),
  );

  const items: PipelineItem[] = rows.flatMap((row) => {
    const tender = byId.get(row.tender_id);
    if (!tender) return [];
    const match = scores.get(row.tender_id);
    return [
      {
        id: tender.id,
        title: tender.title,
        buyer: tender.buyer_name,
        budget: Number(tender.budget_no_tax) > 0 ? Number(tender.budget_no_tax) : null,
        deadline: tender.deadline_date,
        deadlineTime: tender.deadline_time,
        decision: row.decision,
        score: match?.score ?? null,
        gaps: (match?.reasons || []).filter((reason) => reason.type === "gap").length,
      },
    ];
  });

  return (
    <AppShell active="pipeline" companyName={company.name} userEmail={user.email}>
      <PipelineList items={items} />
    </AppShell>
  );
}
