import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { TenderDecision } from "@/components/pipeline/TenderDecision";
import { requireCompany } from "@/lib/company-server";
import type { Decision } from "@/lib/discover";
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

  const { data: tender } = await supabase
    .from("tenders")
    .select("id,title,buyer_name,buyer_nif,region,budget_no_tax,deadline_date,deadline_time,procedure_label,link,source,duration,duration_unit")
    .eq("id", id)
    .maybeSingle();
  if (!tender) notFound();

  const [decision, matches, criteria, extraction, documents, buyer, buyerAwards, similar] = await Promise.all([
    supabase.from("tender_decisions").select("decision").eq("company_id", company.id).eq("tender_id", id).maybeSingle(),
    supabase.rpc("match_tenders", { p_company: company.id, p_limit: 2000 }),
    supabase.from("tender_criteria").select("type,subtype,weight,lot_id").eq("tender_id", id),
    supabase
      .from("tender_extractions")
      .select("output")
      .eq("tender_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("tender_documents").select("kind,name,url").eq("tender_id", id).in("kind", ["pcap", "ppt"]),
    tender.buyer_nif
      ? supabase.from("buyer_stats").select("*").eq("buyer_nif", tender.buyer_nif).maybeSingle()
      : Promise.resolve({ data: null }),
    tender.buyer_nif
      ? supabase
          .from("tender_results")
          .select("tender_id,lot_id,award_date,award_amount_no_tax,winner_name,tenders!inner(title,procedure_label,budget_no_tax,buyer_nif)")
          .eq("tenders.buyer_nif", tender.buyer_nif)
          .not("award_date", "is", null)
          .order("award_date", { ascending: false })
          .limit(300)
      : Promise.resolve({ data: [] }),
    supabase.rpc("similar_tenders", { p_tender: id, p_limit: 40, only_awarded: true }),
  ]);

  const match = ((matches.data || []) as Array<{ tender_id: string; score: number; reasons: MatchReason[] }>).find(
    (row) => row.tender_id === id,
  );

  const data = assembleDecision({
    companyId: company.id!,
    companyNif: company.nif || null,
    tender,
    decision: (decision.data?.decision as Decision | undefined) ?? null,
    match: match ?? null,
    buyer: buyer.data as BuyerStats | null,
    awards: (buyerAwards.data || []) as unknown as AwardRow[],
    similar: (similar.data || []) as SimilarAward[],
    criteria: (criteria.data || []) as Criterion[],
    price: (extraction.data?.output as { price?: DecisionInput["price"] } | null)?.price ?? null,
    documents: (documents.data || []) as DecisionInput["documents"],
  });

  return (
    <AppShell active="pipeline" companyName={company.name} userEmail={user.email}>
      <TenderDecision data={data} openChat={ask === "1"} />
    </AppShell>
  );
}
