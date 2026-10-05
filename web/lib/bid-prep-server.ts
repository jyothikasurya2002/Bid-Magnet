import { buildBreakdown, type NoticeCriterion, type NoticeRequirement } from "./breakdown";
import { buildOutline } from "./draft-outline";
import { awardDiscounts, type AwardRow, type BuyerStats, type SimilarAward } from "./pipeline";
import { advise, marketFrom, setupFrom } from "./price-sim";
import type { createClient } from "./supabase/server";
import type { CompanyProfile } from "./types";

// Everything the Bid prep page needs for one tender, in one call (server side).
// The page keeps `setup` and `market` in state and re-runs simulate()/advise() as the
// user moves the sliders; nothing here needs AI.

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function loadBidPrep(supabase: Supabase, tenderId: string, company: CompanyProfile) {
  const { data: tender } = await supabase
    .from("tenders")
    .select("id,title,buyer_name,buyer_nif,region,budget_no_tax,deadline_date,deadline_time,procedure_label,link")
    .eq("id", tenderId)
    .maybeSingle();
  if (!tender) return null;

  const [criteria, requirements, extraction, documents, buyer, buyerAwards, similar] = await Promise.all([
    supabase.from("tender_criteria").select("type,subtype,weight,lot_id,description").eq("tender_id", tenderId),
    supabase.from("tender_requirements").select("kind,code,description,threshold,lot_id").eq("tender_id", tenderId),
    supabase
      .from("tender_extractions")
      .select("output")
      .eq("tender_id", tenderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("tender_documents").select("kind,name,url").eq("tender_id", tenderId).in("kind", ["pcap", "ppt"]),
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
    supabase.rpc("similar_tenders", { p_tender: tenderId, p_limit: 40, only_awarded: true }),
  ]);

  const checklist = (extraction.data?.output as Record<string, unknown> | undefined) ?? null;
  const docs = (documents.data || []) as Array<{ kind: string; name: string; url: string }>;
  const breakdown = buildBreakdown({
    checklist,
    criteria: (criteria.data || []) as NoticeCriterion[],
    requirements: (requirements.data || []) as NoticeRequirement[],
    documents: docs,
  });

  // Price history: this buyer's winning discounts, plus similar contracts elsewhere.
  const buyerHistory = awardDiscounts((buyerAwards.data || []) as unknown as AwardRow[], 30).map((p) => p.discount);
  const similarHistory = ((similar.data || []) as SimilarAward[])
    .filter((row) => row.tender_id !== tenderId && row.discount !== null)
    .map((row) => Number(row.discount));
  const history = [...buyerHistory, ...similarHistory];
  const stats = buyer.data as BuyerStats | null;

  const price = (checklist?.price as { formula?: string; formula_explained_en?: string; abnormally_low_rule?: string } | undefined) ?? null;
  const setup = setupFrom({ budget: tender.budget_no_tax, pricePoints: breakdown.totals.price || null, price });
  const market = marketFrom(history, stats?.median_bidders ?? null);

  return {
    tender,
    breakdown,
    documents: docs,
    price: {
      setup,
      market,
      advice: advise(setup, market),
      history: { buyer: buyerHistory, similar: similarHistory },
      formulaText: price?.formula ?? null,
      formulaExplained: price?.formula_explained_en ?? null,
      abnormalText: price?.abnormally_low_rule ?? null,
    },
    outline: buildOutline(breakdown, company),
  };
}

export type BidPrepData = NonNullable<Awaited<ReturnType<typeof loadBidPrep>>>;
