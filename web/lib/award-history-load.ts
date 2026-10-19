import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY_NIF, nifVariants, normalizeNif, type CompanyAward } from "./award-history";

// Every award won under this tax ID (joint ventures have their own NIF and aren't included).
export async function loadCompanyAwards(supabase: SupabaseClient, nif: string | null | undefined): Promise<CompanyAward[]> {
  if (!nif || !COMPANY_NIF.test(normalizeNif(nif))) return [];
  const { data, error } = await supabase
    .from("tender_results")
    .select(
      "tender_id,lot_id,award_date,contract_date,award_amount_no_tax,winner_name,tenders!inner(title,procedure_label,budget_no_tax,cpv_codes,region,buyer_nif,buyer_name,duration,duration_unit)",
    )
    .in("winner_nif", nifVariants(nif))
    .limit(1000);
  if (error) {
    console.error("award history failed", error);
    return [];
  }
  return ((data || []) as unknown as Array<CompanyAward & { contract_date: string | null }>).map(({ contract_date, ...award }) => ({
    ...award,
    award_date: award.award_date ?? contract_date,
  }));
}
