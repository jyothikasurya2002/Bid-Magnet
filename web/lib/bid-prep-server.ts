import { buildBreakdown, type Breakdown, type NoticeCriterion, type NoticeRequirement } from "./breakdown";
import { buyerAwards, buyerStats, similarAwarded, tenderBundle, type TenderBundle } from "./data-cache";
import { buildOutline } from "./draft-outline";
import { awardDiscounts, type AwardRow, type BuyerStats, type SimilarAward } from "./pipeline";
import { advise, marketFrom, setupFrom } from "./price-sim";
import type { createClient } from "./supabase/server";
import type { CompanyProfile } from "./types";

// Everything the Bid prep page needs for one tender (server side). The page keeps `setup`
// and `market` in state and re-runs simulate()/advise() as the user moves the sliders;
// nothing here needs AI. Reads go through the shared cache (data-cache.ts).

type Supabase = Awaited<ReturnType<typeof createClient>>;

type PriceText = { formula?: string; formula_explained_en?: string; abnormally_low_rule?: string };

/** Must-meet / formula / judgement split of the tender, from the cached bundle. */
export function breakdownOf(bundle: TenderBundle): Breakdown {
  return buildBreakdown({
    checklist: bundle.checklist,
    criteria: bundle.criteria as NoticeCriterion[],
    requirements: bundle.requirements as NoticeRequirement[],
    documents: bundle.documents.filter((doc) => doc.kind === "pcap" || doc.kind === "ppt"),
  });
}

/** Price simulator inputs: the tender's scoring rules plus past winning discounts. */
export function priceOf(input: { bundle: TenderBundle; breakdown: Breakdown; stats: BuyerStats | null; awards: AwardRow[]; similar: SimilarAward[] }) {
  const { bundle, breakdown } = input;
  const tenderId = bundle.tender?.id;
  // This buyer's winning discounts, plus similar contracts elsewhere.
  const buyerHistory = awardDiscounts(input.awards, 30).map((p) => p.discount);
  const similarHistory = input.similar.filter((row) => row.tender_id !== tenderId && row.discount !== null).map((row) => Number(row.discount));

  const price = (bundle.checklist?.price as PriceText | undefined) ?? null;
  const setup = setupFrom({ budget: bundle.tender?.budget_no_tax ?? null, pricePoints: breakdown.totals.price || null, price });
  const market = marketFrom([...buyerHistory, ...similarHistory], input.stats?.median_bidders ?? null);

  return {
    setup,
    market,
    advice: advise(setup, market),
    history: { buyer: buyerHistory, similar: similarHistory },
    formulaText: price?.formula ?? null,
    formulaExplained: price?.formula_explained_en ?? null,
    abnormalText: price?.abnormally_low_rule ?? null,
    cite: breakdown.price[0]?.cite ?? null,
  };
}

export type BidPrice = ReturnType<typeof priceOf>;

export async function loadBidPrep(supabase: Supabase, tenderId: string, company: CompanyProfile) {
  const bundle = await tenderBundle(supabase, tenderId);
  const tender = bundle.tender;
  if (!tender) return null;

  const [stats, awards, similar] = await Promise.all([
    buyerStats<BuyerStats>(supabase, tender.buyer_nif),
    buyerAwards<AwardRow>(supabase, tender.buyer_nif),
    similarAwarded<SimilarAward>(supabase, tenderId),
  ]);
  const breakdown = breakdownOf(bundle);

  return {
    tender: {
      id: tender.id,
      title: tender.title,
      buyer_name: tender.buyer_name,
      buyer_nif: tender.buyer_nif,
      region: tender.region,
      budget_no_tax: tender.budget_no_tax,
      deadline_date: tender.deadline_date,
      deadline_time: tender.deadline_time,
      procedure_label: tender.procedure_label,
      link: tender.link,
    },
    breakdown,
    documents: bundle.documents.filter((doc) => doc.kind === "pcap" || doc.kind === "ppt"),
    price: priceOf({ bundle, breakdown, stats, awards, similar }),
    outline: buildOutline(breakdown, company),
  };
}

export type BidPrepData = NonNullable<Awaited<ReturnType<typeof loadBidPrep>>>;
