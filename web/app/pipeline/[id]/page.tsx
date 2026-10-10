import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { TenderDecision } from "@/components/pipeline/TenderDecision";
import { COMPANY_NIF, summarizeAwards, trackRecordFor, withTrackRecord } from "@/lib/award-history";
import { requireCompany } from "@/lib/company-server";
import { buyerRecord, competitionRisk } from "@/lib/competition-risk";
import { buyerAwards, buyerStats, companyAwards, companyMatches, similarAwarded, tenderBundle } from "@/lib/data-cache";
import { todayInSpain, type Decision } from "@/lib/discover";
import {
  assembleDecision,
  type AwardRow,
  type BuyerStats,
  type Criterion,
  type DecisionInput,
  type SimilarAward,
} from "@/lib/pipeline";
import type { MatchReason } from "@/lib/types";

export const metadata = {
  title: "Should we bid?",
};

export default async function PipelineTenderPage(props: PageProps<"/pipeline/[id]">) {
  const { id } = await props.params;
  const { ask } = await props.searchParams;
  const { supabase, user, company } = await requireCompany();

  // Tender data comes from the shared cache; only your decision is read fresh.
  const bundle = await tenderBundle(supabase, id);
  const tender = bundle.tender;
  if (!tender) notFound();

  const [decision, matches, buyer, awards, similar, ownAwards] = await Promise.all([
    supabase.from("tender_decisions").select("decision").eq("company_id", company.id).eq("tender_id", id).maybeSingle(),
    companyMatches<{ tender_id: string; score: number; reasons: MatchReason[] }>(supabase, company.id!, company.updated_at, 2000),
    buyerStats<BuyerStats>(supabase, tender.buyer_nif),
    buyerAwards<AwardRow>(supabase, tender.buyer_nif),
    similarAwarded<SimilarAward>(supabase, id),
    companyAwards(supabase, company.nif),
  ]);

  const scored = matches.find(
    (row) => row.tender_id === id,
  );
  const history = summarizeAwards(ownAwards);
  const match = scored ? withTrackRecord(scored, { nif: tender.buyer_nif, name: tender.buyer_name }, history) : undefined;
  const budget = Number(tender.budget_no_tax) > 0 ? Number(tender.budget_no_tax) : null;

  const data = assembleDecision({
    companyId: company.id!,
    companyNif: company.nif || null,
    companyBudget: [company.min_budget === null ? null : Number(company.min_budget), company.max_budget === null ? null : Number(company.max_budget)],
    today: todayInSpain(),
    tender: {
      ...tender,
      budget_no_tax: tender.budget_no_tax === null ? null : Number(tender.budget_no_tax),
      duration: tender.duration === null ? null : Number(tender.duration),
    },
    decision: (decision.data?.decision as Decision | undefined) ?? null,
    match: match ?? null,
    buyer,
    awards,
    similar,
    criteria: bundle.criteria as Criterion[],
    price: (bundle.checklist as { price?: DecisionInput["price"] } | null)?.price ?? null,
    documents: bundle.documents.filter((doc) => doc.kind === "pcap" || doc.kind === "ppt") as DecisionInput["documents"],
    trackRecord: COMPANY_NIF.test((company.nif || "").replace(/[\s.-]/g, "").toUpperCase())
      ? trackRecordFor(ownAwards, {
          buyer_nif: tender.buyer_nif,
          buyer_name: tender.buyer_name,
          cpv_codes: tender.cpv_codes,
          budget,
          duration: tender.duration === null ? null : Number(tender.duration),
          durationUnit: tender.duration_unit,
        })
      : null,
  });

  return (
    <AppShell active="pipeline" companyName={company.name} userEmail={user.email}>
      <TenderDecision
        data={data}
        openChat={ask === "1"}
        risk={competitionRisk({
          procedure: tender.procedure_label,
          urgency: ((tender.extra as { urgency_code?: string } | null)?.urgency_code as string | undefined) ?? null,
          buyer: buyer ? buyerRecord(buyer) : null,
          companyNif: company.nif,
        })}
      />
    </AppShell>
  );
}
