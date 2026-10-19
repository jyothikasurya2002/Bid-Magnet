import { createHash } from "node:crypto";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadCompanyAwards } from "./award-history-load";

// Server-side cache for data that's the same for every signed-in user and only changes
// with the daily import (07:30 Spain): tenders, their documents and criteria, buyer and
// award statistics. Per-company match scores are cached under the profile's version, so
// editing the profile shows new scores straight away.
//
// Callers must have checked the user is signed in (requireCompany): tender data is
// readable by any signed-in user, so sharing it across users exposes nothing new.
// A miss runs the query with the caller's own client; errors are thrown, never cached.

const HALF_HOUR = 1800;
const HOUR = 3600;
const SIX_HOURS = 21_600;

function shared<T>(key: string[], load: () => Promise<T>, revalidate: number, tags: string[] = ["tenders"]) {
  return unstable_cache(load, key, { revalidate, tags })();
}

// Cached functions may not touch cookies, so queries inside them use a client that
// carries the signed-in user's token instead (read from the cookie beforehand).
const reader = cache(async (supabase: SupabaseClient): Promise<SupabaseClient> => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
});

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Could not load ${what}: ${result.error.message}`);
  return result.data as T;
}

const TENDER_COLUMNS =
  "id,title,buyer_name,buyer_nif,buyer_city,region,status_label,contract_type_label,procedure_label,budget_no_tax,estimated_value,cpv_codes,duration,duration_unit,deadline_date,deadline_time,has_lots,lots,link,source,extra";

export type TenderRecord = {
  id: string;
  title: string;
  buyer_name: string | null;
  buyer_nif: string | null;
  buyer_city: string | null;
  region: string | null;
  status_label: string | null;
  contract_type_label: string | null;
  procedure_label: string | null;
  budget_no_tax: number | string | null;
  estimated_value: number | string | null;
  cpv_codes: string[] | null;
  duration: number | string | null;
  duration_unit: string | null;
  deadline_date: string | null;
  deadline_time: string | null;
  has_lots: boolean | null;
  lots: unknown;
  link: string | null;
  source: string | null;
  extra: unknown;
};

export type TenderBundle = {
  tender: TenderRecord | null;
  criteria: Array<{ lot_id: string | null; type: string | null; subtype: string | null; description: string | null; weight: number | string | null }>;
  requirements: Array<{ lot_id: string | null; kind: string | null; code: string | null; description: string | null; threshold: number | string | null }>;
  checklist: Record<string, unknown> | null;
  documents: Array<{ kind: string; name: string; url: string }>;
};

// Everything about one tender that the decision page, the bid plan and Scout read.
export async function tenderBundle(client: SupabaseClient, id: string): Promise<TenderBundle> {
  const supabase = await reader(client);
  return shared(
    ["tender-bundle", id],
    async () => {
      const [tender, criteria, requirements, extraction, documents] = await Promise.all([
        supabase.from("tenders").select(TENDER_COLUMNS).eq("id", id).maybeSingle(),
        supabase.from("tender_criteria").select("lot_id,type,subtype,description,weight").eq("tender_id", id),
        supabase.from("tender_requirements").select("lot_id,kind,code,description,threshold").eq("tender_id", id),
        supabase.from("tender_extractions").select("output").eq("tender_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("tender_documents").select("kind,name,url").eq("tender_id", id),
      ]);
      return {
        tender: must(tender, "the tender") as TenderRecord | null,
        criteria: must(criteria, "the award criteria") || [],
        requirements: must(requirements, "the requirements") || [],
        checklist: (must(extraction, "the checklist")?.output as Record<string, unknown> | undefined) ?? null,
        documents: (must(documents, "the documents") || []) as TenderBundle["documents"],
      };
    },
    HALF_HOUR,
  );
}

// The slowest query we run (~3 s): past awarded tenders like this one.
export async function similarAwarded<T>(client: SupabaseClient, id: string): Promise<T[]> {
  const supabase = await reader(client);
  return shared(
    ["similar-awarded", id],
    async () => must(await supabase.rpc("similar_tenders", { p_tender: id, p_limit: 40, only_awarded: true }), "similar tenders") || [],
    SIX_HOURS,
  );
}

export async function buyerStats<T>(client: SupabaseClient, nif: string | null): Promise<T | null> {
  if (!nif) return null;
  const supabase = await reader(client);
  return shared(
    ["buyer-stats", nif],
    async () => must(await supabase.from("buyer_stats").select("*").eq("buyer_nif", nif).maybeSingle(), "buyer stats") as T | null,
    HOUR,
  );
}

export async function buyerAwards<T>(client: SupabaseClient, nif: string | null): Promise<T[]> {
  if (!nif) return [];
  const supabase = await reader(client);
  return shared(
    ["buyer-awards", nif],
    async () =>
      (must(
        await supabase
          .from("tender_results")
          .select("tender_id,lot_id,award_date,award_amount_no_tax,winner_name,tenders!inner(title,procedure_label,budget_no_tax,buyer_nif)")
          .eq("tenders.buyer_nif", nif)
          .not("award_date", "is", null)
          .order("award_date", { ascending: false })
          .limit(300),
        "the buyer's awards",
      ) || []) as T[],
    HOUR,
  );
}

export async function companyAwards(client: SupabaseClient, nif: string | null | undefined) {
  if (!nif) return [];
  const supabase = await reader(client);
  return shared(["company-awards", nif.toUpperCase()], () => loadCompanyAwards(supabase, nif), SIX_HOURS);
}

// match_tenders for one company. `version` is the profile's updated_at.
export async function companyMatches<T>(client: SupabaseClient, companyId: string, version: string | undefined, limit: number): Promise<T[]> {
  const supabase = await reader(client);
  return shared(
    ["matches", companyId, version ?? "", String(limit)],
    async () => (must(await supabase.rpc("match_tenders", { p_company: companyId, p_limit: limit }), "your matches") || []) as T[],
    900,
    ["tenders", `company:${companyId}`],
  );
}

// Rows for a set of tender ids (Discover's extra columns and criteria), keyed by the set.
export async function rowsForTenders<T>(
  client: SupabaseClient,
  label: string,
  ids: string[],
  load: (supabase: SupabaseClient, ids: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (!ids.length) return [];
  const supabase = await reader(client);
  const digest = createHash("sha1").update([...ids].sort().join(",")).digest("hex");
  return shared([label, digest], () => load(supabase, ids), HALF_HOUR);
}

// Lists that don't depend on the company (renewals, prior notices, last import time).
// `load` gets a cookie-free client to query with.
export async function sharedList<T>(
  client: SupabaseClient,
  key: string,
  load: (supabase: SupabaseClient) => Promise<T>,
  revalidate = HALF_HOUR,
): Promise<T> {
  const supabase = await reader(client);
  return shared(["list", key], () => load(supabase), revalidate);
}
