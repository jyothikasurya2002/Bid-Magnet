import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BidPlanView } from "@/components/bid/BidPlanView";
import { buildPlan, type Checklist, type NoticeCriterion, type NoticeRequirement } from "@/lib/bid-plan";
import { displayName, requireCompany } from "@/lib/company-server";
import { buyerStats, tenderBundle } from "@/lib/data-cache";
import { durationLabel, sourceLabel, todayInSpain, type Decision } from "@/lib/discover";
import type { ChatDocument } from "@/lib/tender-chat";

export const metadata = {
  title: "Bid plan",
};

export default async function BidPlanPage(props: PageProps<"/bid/[id]">) {
  const { id } = await props.params;
  const { task } = await props.searchParams;
  const { supabase, user, company } = await requireCompany();

  const bundle = await tenderBundle(supabase, id);
  const tender = bundle.tender;
  if (!tender) notFound();

  const [decision, vault, stats] = await Promise.all([
    supabase.from("tender_decisions").select("decision").eq("company_id", company.id).eq("tender_id", id).maybeSingle(),
    supabase.from("company_documents").select("document_type").eq("company_id", company.id),
    buyerStats<{ median_discount: number | string | null; median_bidders: number | string | null }>(supabase, tender.buyer_nif),
  ]);
  const budget = Number(tender.budget_no_tax) > 0 ? Number(tender.budget_no_tax) : null;

  const platform = sourceLabel(tender.source, tender.link, tender.region);
  const plan = buildPlan({
    today: todayInSpain(),
    deadline: tender.deadline_date,
    platform,
    checklist: bundle.checklist as Checklist | null,
    criteria: bundle.criteria as NoticeCriterion[],
    requirements: bundle.requirements as NoticeRequirement[],
    company,
    vault: (vault.data || []).map((row) => String(row.document_type || "").toUpperCase()),
    budget,
    deadlineTime: tender.deadline_time,
    buyer: stats
      ? {
          medianDiscount: stats.median_discount === null ? null : Number(stats.median_discount),
          medianBidders: stats.median_bidders === null ? null : Number(stats.median_bidders),
        }
      : null,
  });

  return (
    <AppShell active="bid-prep" companyName={company.name} userEmail={user.email}>
      <BidPlanView
        companyId={company.id!}
        me={{ id: user.id, name: displayName(user.email) }}
        initialTask={typeof task === "string" ? task : null}
        decision={(decision.data?.decision as Decision | undefined) ?? null}
        plan={plan}
        documents={bundle.documents.filter((doc) => doc.kind === "pcap" || doc.kind === "ppt") as ChatDocument[]}
        tender={{
          id: tender.id,
          title: tender.title,
          buyer: tender.buyer_name,
          budget,
          deadline: tender.deadline_date,
          deadlineTime: tender.deadline_time,
          procedure: tender.procedure_label,
          duration: durationLabel(tender.duration === null ? null : Number(tender.duration), tender.duration_unit),
          platform,
          link: tender.link,
        }}
      />
    </AppShell>
  );
}
