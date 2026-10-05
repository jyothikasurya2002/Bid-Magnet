import Link from "next/link";
import { businessDaysUntil, type Decision } from "@/lib/discover";

export type PipelineItem = {
  id: string;
  title: string;
  buyer: string | null;
  budget: number | null;
  deadline: string | null;
  deadlineTime: string | null;
  decision: Decision;
  score: number | null;
  gaps: number;
};

const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function isClosed(item: PipelineItem, today: string) {
  return item.deadline !== null && item.deadline < today;
}

// Tenders you marked Interested or Later in Discover, soonest deadline first.
export function PipelineList({ items, today = new Date().toISOString().slice(0, 10) }: { items: PipelineItem[]; today?: string }) {
  const byDeadline = [...items].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  const groups = [
    { key: "go", title: "Interested", hint: "Decide whether to bid", items: byDeadline.filter((item) => item.decision === "go" && !isClosed(item, today)) },
    { key: "watch", title: "Later", hint: "Parked for now", items: byDeadline.filter((item) => item.decision === "watch" && !isClosed(item, today)) },
    { key: "closed", title: "Closed", hint: "Deadline passed", items: byDeadline.filter((item) => isClosed(item, today)).reverse() },
  ].filter((group) => group.items.length);

  return (
    <main className="pipe">
      <header className="pipe-head">
        <div>
          <h1>Pipeline</h1>
          <p>Tenders you’re considering. Open one to see the evidence, ask the AI about it, and make the call.</p>
        </div>
      </header>

      {groups.length ? (
        groups.map((group) => (
          <section key={group.key} className="pipe-group" aria-labelledby={`pipe-${group.key}`}>
            <h2 id={`pipe-${group.key}`}>
              {group.title} <span className="mono">{group.items.length}</span>
              <small>{group.hint}</small>
            </h2>
            <ul>
              {group.items.map((item) => (
                <PipelineRow key={item.id} item={item} closed={group.key === "closed"} />
              ))}
            </ul>
          </section>
        ))
      ) : (
        <div className="pipe-empty">
          <strong>Nothing in your pipeline yet</strong>
          <p>Mark tenders as Interested in Discover and they’ll show up here.</p>
          <Link href="/discover" className="primary-link">
            Go to Discover
          </Link>
        </div>
      )}
    </main>
  );
}

function PipelineRow({ item, closed }: { item: PipelineItem; closed: boolean }) {
  const days = item.deadline && !closed ? businessDaysUntil(item.deadline) : null;
  return (
    <li className={closed ? "pipe-row pipe-row-closed" : "pipe-row"}>
      <Link href={`/pipeline/${item.id}`} className="pipe-row-main">
        <span className="pipe-fit mono">{item.score ?? "—"}</span>
        <span className="pipe-text">
          <strong lang="es">{item.title}</strong>
          <small>
            {[item.buyer, item.budget !== null ? EURO.format(item.budget) : null].filter(Boolean).join(" · ")}
            {item.gaps ? <em> · {item.gaps} dealbreaker{item.gaps === 1 ? "" : "s"}</em> : null}
          </small>
        </span>
        <span className={days !== null && days <= 5 ? "pipe-days pipe-days-urgent" : "pipe-days"}>
          {item.deadline
            ? closed
              ? `Closed ${DATE.format(new Date(`${item.deadline}T00:00:00`))}`
              : `${days} business day${days === 1 ? "" : "s"}`
            : "No deadline"}
        </span>
      </Link>
      {closed ? null : (
        <Link href={`/pipeline/${item.id}?ask=1`} className="pipe-ask">
          Ask AI
        </Link>
      )}
    </li>
  );
}
