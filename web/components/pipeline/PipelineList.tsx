import Link from "next/link";
import { businessDaysUntil, isStillOpen, todayInSpain, type Decision } from "@/lib/discover";
import { dateFormat } from "@/lib/dates";

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
const DATE = dateFormat({});

function isClosed(item: PipelineItem, today: string) {
  return !isStillOpen(item.deadline, today);
}

// Tenders you marked Interested or Later in Discover, soonest deadline first.
export function PipelineList({ items, today = todayInSpain() }: { items: PipelineItem[]; today?: string }) {
  const byDeadline = [...items].sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  const open = byDeadline.filter((item) => !isClosed(item, today));
  const daysLeft = (item: PipelineItem) => (item.deadline ? businessDaysUntil(item.deadline) : Infinity);
  const interested = open.filter((item) => item.decision === "go");

  // Interested tenders by how soon you have to act; parked and closed ones after.
  const groups = [
    {
      key: "week",
      title: "Closing this week",
      hint: "Decide now",
      items: interested.filter((item) => daysLeft(item) <= 5),
    },
    {
      key: "next",
      title: "Next two weeks",
      hint: "Enough time to prepare a bid",
      items: interested.filter((item) => daysLeft(item) > 5 && daysLeft(item) <= 10),
    },
    {
      key: "later",
      title: "Further out",
      hint: "Plenty of time",
      items: interested.filter((item) => daysLeft(item) > 10),
    },
    {
      key: "watch",
      title: "Parked",
      hint: "You marked these Later",
      items: open.filter((item) => item.decision === "watch"),
    },
  ].filter((group) => group.items.length);
  const closed = byDeadline.filter((item) => isClosed(item, today)).reverse();
  const thisWeek = groups.find((group) => group.key === "week")?.items.length ?? 0;

  return (
    <main className="pipe">
      <header className="pipe-head">
        <div>
          <h1>Pipeline</h1>
          <p>Tenders you’re considering. Open one to see the evidence, ask the AI about it, and make the call.</p>
        </div>
      </header>

      {groups.length || closed.length ? (
        <>
          {thisWeek ? (
            <p className="pipe-summary">
              <strong>{thisWeek}</strong> to decide this week · {interested.length} interested
              {open.length > interested.length ? ` · ${open.length - interested.length} parked` : ""}
            </p>
          ) : null}
          {groups.map((group) => (
            <details key={group.key} className="pipe-group pipe-fold" open>
              <summary>
                {group.title} <span className="mono">{group.items.length}</span>
                <small>{group.hint}</small>
              </summary>
              <ul>
                {group.items.map((item) => (
                  <PipelineRow key={item.id} item={item} closed={false} />
                ))}
              </ul>
            </details>
          ))}
          {closed.length ? (
            <details className="pipe-group pipe-fold pipe-closed" open={!groups.length}>
              <summary>
                Closed <span className="mono">{closed.length}</span>
                <small>Closes today or already closed: too late to bid</small>
              </summary>
              <ul>
                {closed.map((item) => (
                  <PipelineRow key={item.id} item={item} closed />
                ))}
              </ul>
            </details>
          ) : null}
        </>
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
              ? item.deadline === todayInSpain()
                ? "Closes today"
                : `Closed ${DATE.format(new Date(`${item.deadline}T00:00:00`))}`
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
