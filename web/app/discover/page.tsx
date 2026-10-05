import type { SupabaseClient } from "@supabase/supabase-js";
import { AppShell } from "@/components/AppShell";
import { DiscoverFeed } from "@/components/discover/DiscoverFeed";
import { isStillOpen, matchesSectors, todayInSpain, type Decision, type FeedTender } from "@/lib/discover";
import { summarizeAwards, withTrackRecord } from "@/lib/award-history";
import { requireCompany } from "@/lib/company-server";
import { companyAwards, companyMatches, rowsForTenders, sharedList } from "@/lib/data-cache";
import type { MatchReason } from "@/lib/types";

export const metadata = {
  title: "Discover",
};

type TenderRow = {
  id: string;
  title: string;
  buyer_name: string | null;
  region: string | null;
  budget_no_tax: number | null;
  deadline_date: string | null;
  deadline_time: string | null;
  procedure_label: string | null;
  link: string | null;
  source: string | null;
  duration: number | null;
  duration_unit: string | null;
  cpv_codes?: string[] | null;
};

const TENDER_FIELDS =
  "id,title,buyer_name,region,budget_no_tax,deadline_date,deadline_time,procedure_label,link,source,duration,duration_unit";

function fromRow(row: TenderRow, kind: FeedTender["kind"]): FeedTender {
  return {
    tender_id: row.id,
    title: row.title,
    buyer_name: row.buyer_name,
    region: row.region,
    budget_no_tax: Number(row.budget_no_tax) > 0 ? Number(row.budget_no_tax) : null, // 0 means not given
    deadline_date: row.deadline_date,
    deadline_time: row.deadline_time,
    procedure_label: row.procedure_label,
    score: null,
    reasons: [],
    has_checklist: false,
    link: row.link,
    source: row.source || "placsp",
    duration: row.duration === null ? null : Number(row.duration),
    duration_unit: row.duration_unit,
    kind,
  };
}

// Renewals ending in the next nine months; prior notices from the last four months.
function dateWindow(now = new Date()) {
  const day = 86_400_000;
  return {
    today: now.toISOString().slice(0, 10),
    inNineMonths: new Date(now.getTime() + 270 * day).toISOString().slice(0, 10),
    since: new Date(now.getTime() - 120 * day).toISOString(),
  };
}

type DetailRow = Pick<TenderRow, "id" | "source" | "link" | "duration" | "duration_unit" | "deadline_time"> & {
  it_segment: string | null;
  contract_type_label: string | null;
  has_lots: boolean | null;
  buyer_nif: string | null;
};
type CriterionRow = { tender_id: string; type: string | null; subtype: string | null; weight: number | null; lot_id: string | null };

async function loadDetails(supabase: SupabaseClient, ids: string[]) {
  const { data, error } = await supabase
    .from("tenders")
    .select("id,source,link,duration,duration_unit,deadline_time,it_segment,contract_type_label,has_lots,buyer_nif")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data || []) as DetailRow[];
}

// Award criteria, for the "how it's scored" filter. Batched to stay under the row limit.
async function loadCriteria(supabase: SupabaseClient, ids: string[]) {
  const batches = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 40) }, (_, batch) =>
      supabase
        .from("tender_criteria")
        .select("tender_id,type,subtype,weight,lot_id")
        .in("tender_id", ids.slice(batch * 40, batch * 40 + 40)),
    ),
  );
  const failed = batches.find((batch) => batch.error);
  if (failed?.error) throw new Error(failed.error.message);
  return batches.flatMap((batch) => (batch.data || []) as CriterionRow[]);
}

export default async function DiscoverPage() {
  const { supabase, user, company } = await requireCompany();
  const { today, inNineMonths, since } = dateWindow();

  // Shared lists and your matches come from the cache; your decisions are always fresh.
  type MatchRow = Omit<FeedTender, "source" | "duration" | "duration_unit" | "deadline_time" | "kind"> & { reasons: MatchReason[] };
  const [matchRows, decisions, renewals, signals, latest, awards] = await Promise.all([
    companyMatches<MatchRow>(supabase, company.id!, company.updated_at, 300),
    supabase.from("tender_decisions").select("tender_id,decision").eq("company_id", company.id),
    sharedList(supabase, `renewals:${today}`, async (reader) => {
      const { data, error } = await reader
        .from("upcoming_renewals")
        .select("tender_id,title,buyer_name,region,cpv_codes,incumbent,award_amount_no_tax,estimated_end,duration,duration_unit")
        .gte("estimated_end", today)
        .lte("estimated_end", inNineMonths)
        .order("estimated_end")
        .limit(1500);
      if (error) throw new Error(error.message);
      return data || [];
    }),
    sharedList(supabase, `signals:${today}`, async (reader) => {
      const { data, error } = await reader
        .from("tenders")
        .select(`${TENDER_FIELDS},cpv_codes`)
        .eq("status", "PRE")
        .not("it_segment", "is", null)
        .gte("updated", since)
        .limit(300);
      if (error) throw new Error(error.message);
      return data || [];
    }),
    sharedList(
      supabase,
      "latest-import",
      async (reader) => (await reader.from("tenders").select("ingested_at").order("ingested_at", { ascending: false }).limit(1).maybeSingle()).data,
      600,
    ),
    companyAwards(supabase, company.nif),
  ]);
  const decided = new Map<string, Decision>(
    (decisions.data || []).map((row: { tender_id: string; decision: Decision }) => [row.tender_id, row.decision]),
  );
  const matchIds = new Set(matchRows.map((row) => row.tender_id));
  const extraIds = [...decided.keys()].filter((id) => !matchIds.has(id));

  const ids = [...matchIds];
  const [details, criteriaRows, decidedRows] = await Promise.all([
    rowsForTenders(supabase, "discover-details", ids, loadDetails),
    rowsForTenders(supabase, "discover-criteria", ids, loadCriteria),
    extraIds.length ? supabase.from("tenders").select(TENDER_FIELDS).in("id", extraIds) : Promise.resolve({ data: [] }),
  ]);
  const detail = new Map(details.map((row) => [row.id, row]));

  const criteriaByTender = new Map<string, CriterionRow[]>();
  for (const row of criteriaRows) {
    criteriaByTender.set(row.tender_id, [...(criteriaByTender.get(row.tender_id) || []), row]);
  }
  const points = (id: string) => {
    const rows = criteriaByTender.get(id) || [];
    const whole = rows.some((row) => !row.lot_id) ? rows.filter((row) => !row.lot_id) : rows;
    if (!whole.length) return { price: null, judgement: null };
    const sum = (list: CriterionRow[]) => list.reduce((total, row) => total + Number(row.weight || 0), 0);
    return { price: sum(whole.filter((row) => row.subtype === "1")), judgement: sum(whole.filter((row) => row.type === "SUBJ")) };
  };

  // Your own award history: a fit-score bonus for buyers you've already won from.
  const history = summarizeAwards(awards);

  const open: FeedTender[] = matchRows.map((row) => {
    const extra = detail.get(row.tender_id);
    return {
      ...row,
      budget_no_tax: Number(row.budget_no_tax) > 0 ? Number(row.budget_no_tax) : null, // 0 means not given
      reasons: Array.isArray(row.reasons) ? row.reasons : [],
      link: extra?.link ?? row.link,
      source: extra?.source || "placsp",
      duration: extra?.duration === null || extra?.duration === undefined ? null : Number(extra.duration),
      duration_unit: extra?.duration_unit ?? null,
      deadline_time: extra?.deadline_time ?? null,
      it_segment: extra?.it_segment ?? null,
      contract_type: extra?.contract_type_label ?? null,
      has_lots: extra?.has_lots ?? null,
      price_points: points(row.tender_id).price,
      judgement_points: points(row.tender_id).judgement,
      kind: "open" as const,
    };
  })
    .map((tender) => withTrackRecord(tender, { nif: detail.get(tender.tender_id)?.buyer_nif ?? null, name: tender.buyer_name }, history))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const inRegion = (region: string | null) =>
    !company.regions.length || (region !== null && (company.regions.includes(region) || region === "Nacional"));

  type RenewalRow = {
    tender_id: string;
    title: string;
    buyer_name: string | null;
    region: string | null;
    cpv_codes: string[] | null;
    incumbent: string | null;
    award_amount_no_tax: number | null;
    estimated_end: string | null;
    duration: number | null;
    duration_unit: string | null;
  };
  const seenRenewal = new Set<string>();
  const renewalList: FeedTender[] = (renewals as RenewalRow[])
    .filter((row) => matchesSectors(row.cpv_codes, company.cpv_prefixes) && inRegion(row.region))
    .filter((row) => !seenRenewal.has(row.tender_id) && Boolean(seenRenewal.add(row.tender_id)))
    .slice(0, 200)
    .map((row) => ({
      ...fromRow(
        {
          id: row.tender_id,
          title: row.title,
          buyer_name: row.buyer_name,
          region: row.region,
          budget_no_tax: row.award_amount_no_tax,
          deadline_date: null,
          deadline_time: null,
          procedure_label: null,
          link: null,
          source: null,
          duration: row.duration,
          duration_unit: row.duration_unit,
        },
        "renewal",
      ),
      incumbent: row.incumbent,
      estimated_end: row.estimated_end,
    }));

  const signalList = (signals as TenderRow[])
    .filter((row) => matchesSectors(row.cpv_codes ?? null, company.cpv_prefixes))
    .map((row) => fromRow(row, "signal"));

  const decidedElsewhere = ((decidedRows.data || []) as TenderRow[]).map((row) => fromRow(row, "open"));
  // Hide anything closing today or already closed.
  const spainToday = todayInSpain();
  const biddable = [...open, ...decidedElsewhere].filter((tender) => isStillOpen(tender.deadline_date, spainToday));

  return (
    <AppShell active="discover" companyName={company.name} userEmail={user.email}>
      <DiscoverFeed
        companyId={company.id!}
        budget={[company.min_budget, company.max_budget]}
        myRegions={company.regions}
        open={biddable}
        renewals={renewalList}
        signals={signalList}
        initialDecisions={Object.fromEntries(decided)}
        updatedAt={(latest as { ingested_at: string } | null)?.ingested_at ?? null}
      />
    </AppShell>
  );
}
