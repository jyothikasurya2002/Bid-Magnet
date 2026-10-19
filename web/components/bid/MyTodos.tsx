"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { myTasks, planStorageKey, type TaskLike } from "@/lib/bid-plan";
import { dateFormat } from "@/lib/dates";
import { usePlanStates, writeTask } from "./plan-store";

export type TodoTender = { id: string; title: string; days: string[]; tasks: TaskLike[] };

const DUE = dateFormat({ weekday: true });
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);
const subscribeNothing = () => () => {};

type Todo = ReturnType<typeof myTasks>[number] & { tender: TodoTender };

function bucket(todo: Todo, today: string, weekEnd: string) {
  if (todo.late) return "Overdue";
  if (todo.due === today) return "Today";
  if (todo.due <= weekEnd) return "This week";
  return "Later";
}

// Everything you've taken across your bids, by when it's due.
export function MyTodos({ companyId, userId, tenders }: { companyId: string; userId: string; tenders: TodoTender[] }) {
  const states = usePlanStates(
    companyId,
    tenders.map((tender) => tender.id),
  );
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  if (!hydrated) return null;

  const todos: Todo[] = tenders
    .flatMap((tender) => myTasks(tender.tasks, states[tender.id] || {}, tender.days, userId).map((item) => ({ ...item, tender })))
    .sort((a, b) => a.due.localeCompare(b.due));
  const today = tenders[0]?.days[0] ?? "";
  // Five business days from today, from any plan long enough to have them.
  const weekEnd = tenders.map((tender) => tender.days[4]).filter(Boolean).sort()[0] ?? "9999";

  if (!todos.length) {
    return (
      <section className="todos todos-empty" aria-label="Your to-dos">
        <h2>Your to-dos</h2>
        <p>
          Nothing assigned to you yet. Open a bid plan and press <span className="bid-avatar bid-avatar-empty bid-avatar-inline">+</span>{" "}
          on a task to take it. It shows up here with its deadline.
        </p>
      </section>
    );
  }

  const groups = ["Overdue", "Today", "This week", "Later"]
    .map((label) => ({ label, items: todos.filter((todo) => bucket(todo, today, weekEnd) === label) }))
    .filter((group) => group.items.length);

  return (
    <section className="todos" aria-label="Your to-dos">
      <h2>
        Your to-dos <span className="mono">{todos.length}</span>
      </h2>
      {groups.map((group) => (
        <div key={group.label} className={group.label === "Overdue" ? "todos-group todos-overdue" : "todos-group"}>
          <h3>{group.label}</h3>
          <ul>
            {group.items.map(({ task, tender, due, late, status }) => (
              <li key={`${tender.id}:${task.id}`}>
                <button
                  type="button"
                  className="bid-check"
                  aria-label={`Mark “${task.title}” as done`}
                  onClick={() => writeTask(planStorageKey(companyId, tender.id), task.id, { status: "done" })}
                />
                <Link href={`/bid/${tender.id}?task=${encodeURIComponent(task.id)}`} className="todos-name">
                  <span lang="es">{task.title}</span>
                  <small lang="es">{tender.title}</small>
                </Link>
                {status === "doing" ? <span className="bid-mine-status">In progress</span> : null}
                <span className="todos-due">{late ? `Was due ${DUE.format(date(due))}` : DUE.format(date(due))}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// "2 for you · next Wed 7 Oct" on a bid in the list.
export function MyCount({ companyId, userId, tender }: { companyId: string; userId: string; tender: TodoTender }) {
  const states = usePlanStates(companyId, [tender.id]);
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  if (!hydrated) return null;
  const mine = myTasks(tender.tasks, states[tender.id] || {}, tender.days, userId);
  if (!mine.length) return null;
  return (
    <span className={mine.some((item) => item.late) ? "bids-mine bids-mine-late" : "bids-mine"}>
      {mine.length} for you · {mine[0].late ? "overdue" : `next ${DUE.format(date(mine[0].due))}`}
    </span>
  );
}
