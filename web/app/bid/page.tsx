import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { MyCount, MyTodos, type TodoTender } from "@/components/bid/MyTodos";
import { buildPlan, type Checklist, type NoticeCriterion, type NoticeRequirement } from "@/lib/bid-plan";
import { requireCompany } from "@/lib/company-server";
import { tenderBundle } from "@/lib/data-cache";
import { dateFormat } from "@/lib/dates";
import { businessDaysUntil, isStillOpen, sourceLabel, todayInSpain } from "@/lib/discover";

export const metadata = {
  title: "Bid prep",
};

const DATE = dateFormat({ weekday: true });
const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

type Row = {
  id: string;
  title: string;
  buyer_name: string | null;
  budget_no_tax: number | string | null;
  deadline_date: string | null;
  deadline_time: string | null;
};

// Every tender you're bidding on, closest deadline first.
export default async function BidPrepPage() {
  const { supabase, user, company } = await requireCompany();
  const { data: decisions } = await supabase
    .from("tender_decisions")
    .select("tender_id")
    .eq("company_id", company.id)
    .eq("decision", "go");
  const ids = (decisions || []).map((row) => row.tender_id as string);

  // Each bid's plan (cached tender data) gives the to-do list its tasks and due dates.
  const today = todayInSpain();
  const [bundles, vault] = await Promise.all([
    Promise.all(ids.map((id) => tenderBundle(supabase, id))),
    supabase.from("company_documents").select("document_type").eq("company_id", company.id),
  ]);
  const vaultTypes = (vault.data || []).map((row) => String(row.document_type || "").toUpperCase());
  const open = bundles
    .filter((bundle) => bundle.tender && isStillOpen(bundle.tender.deadline_date, today))
    .sort((a, b) => (a.tender!.deadline_date ?? "9999").localeCompare(b.tender!.deadline_date ?? "9999"));
  const rows: Row[] = open.map((bundle) => bundle.tender as unknown as Row);
  const plans: TodoTender[] = open.map((bundle) => {
    const tender = bundle.tender!;
    const plan = buildPlan({
      today,
      deadline: tender.deadline_date,
      platform: sourceLabel(tender.source, tender.link, tender.region),
      checklist: bundle.checklist as Checklist | null,
      criteria: bundle.criteria as NoticeCriterion[],
      requirements: bundle.requirements as NoticeRequirement[],
      company,
      vault: vaultTypes,
    });
    return {
      id: tender.id,
      title: tender.title,
      days: plan.days,
      tasks: plan.groups.flatMap((group) =>
        group.tasks.map(({ id, title, kind, start, end, check, conditional }) => ({ id, title, kind, start, end, check, conditional })),
      ),
    };
  });
  const planFor = new Map(plans.map((plan) => [plan.id, plan]));

  return (
    <AppShell active="bid-prep" companyName={company.name} userEmail={user.email}>
      <main className="pipe bids">
        <header className="pipe-head">
          <div>
            <h1>Bid prep</h1>
            <p>
              {rows.length
                ? `${rows.length} bid${rows.length === 1 ? "" : "s"} in progress. Each plan lays out every task by envelope, up to the deadline.`
                : "Nothing to prepare yet."}
            </p>
          </div>
        </header>

        {rows.length ? <MyTodos companyId={company.id!} userId={user.id} tenders={plans} /> : null}


        {rows.length ? (
          <ul className="bids-list">
            {rows.map((row) => {
              const days = row.deadline_date ? businessDaysUntil(row.deadline_date) : null;
              const budget = Number(row.budget_no_tax);
              return (
                <li key={row.id}>
                  <Link href={`/bid/${row.id}`} className="bids-row">
                    <span className="bids-main">
                      <strong lang="es">{row.title}</strong>
                      <small>
                        {[row.buyer_name, budget > 0 ? EURO.format(budget) : null].filter(Boolean).join(" · ")}
                      </small>
                    </span>
                    <span className="bids-tags">
                      <MyCount companyId={company.id!} userId={user.id} tender={planFor.get(row.id)!} />
                    </span>
                    <span className="bids-deadline">
                      <b>{row.deadline_date ? DATE.format(new Date(`${row.deadline_date}T00:00:00`)) : "No deadline"}</b>
                      {days !== null ? (
                        <small className={days <= 5 ? "bids-urgent" : undefined}>
                          {days} business day{days === 1 ? "" : "s"} left
                        </small>
                      ) : null}
                    </span>
                    <span className="bids-open" aria-hidden="true">
                      Open plan →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="bids-empty">
            <strong>Mark a tender as Interested to start a bid plan</strong>
            <p>Swipe through Discover, or open a tender in your pipeline and choose Interested.</p>
            <div>
              <Link href="/discover" className="button">
                Go to Discover
              </Link>
              <Link href="/pipeline" className="button pane-secondary">
                Open your pipeline
              </Link>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
