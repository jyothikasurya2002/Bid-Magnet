"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ScoutChat, type ScoutChatHandle, type ScoutRequest } from "@/components/scout/ScoutChat";
import { ScoutLayout } from "@/components/scout/ScoutLayout";
import { readRaw, subscribe, usePlanState, useStored } from "./plan-store";
import { pct, PriceTab, priceKey, type SavedPrice } from "./PriceSimulator";
import { ProposalOutline } from "./ProposalOutline";
import {
  myTasks,
  progress,
  statusOf,
  taskSpan,
  type BidPlan,
  type Cite,
  type PlanState,
  type PlanTask,
  type TaskState,
  type TaskStatus,
} from "@/lib/bid-plan";
import type { BidPrice } from "@/lib/bid-prep-server";
import { dateFormat } from "@/lib/dates";
import type { OutlineSection, ProposalOutline as Outline } from "@/lib/draft-outline";
import { businessDaysUntil, isStillOpen, type Decision } from "@/lib/discover";
import { scoutKey, type ScoutStore } from "@/lib/scout-threads";
import type { ChatDocument } from "@/lib/tender-chat";

type TenderInfo = {
  id: string;
  title: string;
  buyer: string | null;
  budget: number | null;
  deadline: string | null;
  deadlineTime: string | null;
  procedure: string | null;
  duration: string | null;
  platform: string;
  link: string | null;
};

export type Me = { id: string; name: string };

export type BidView = "plan" | "price" | "proposal";

type Props = {
  companyId: string;
  me: Me;
  initialTask: string | null;
  initialView: BidView;
  outline: Outline;
  price: Promise<BidPrice>;
  decision: Decision | null;
  plan: BidPlan;
  documents: ChatDocument[];
  tender: TenderInfo;
};

const EURO = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const SHORT = dateFormat({ weekday: true });
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const SUGGESTIONS = [
  "What goes in each envelope, and in what format?",
  "Draft the clarification questions to send to the buyer.",
  "Which formula commitments are worth making for points?",
  "What price keeps us safe from the abnormally-low rule?",
];

const STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", doing: "In progress", done: "Done", skip: "Not needed" };

const date = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);

// Which tasks already have a Scout chat, read from the saved threads.
function useTalkedAbout(companyId: string, tenderId: string) {
  const raw = useSyncExternalStore(subscribe, () => readRaw(scoutKey(companyId, tenderId)), () => "{}");
  return useMemo(() => {
    try {
      const store = JSON.parse(raw) as Partial<ScoutStore>;
      return new Set((store.threads || []).filter((thread) => thread.messages.length && thread.topic).map((thread) => thread.topic!.key));
    } catch {
      return new Set<string>();
    }
  }, [raw]);
}

const subscribeNothing = () => () => {};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "").slice(0, 2)).toUpperCase();
}

// ---------- Scout topics: one chat per task ----------

const topicKey = (task: PlanTask) => `task:${task.id}`;

function shortTitle(task: PlanTask) {
  return task.title.replace(/^(Write|Decide): /, "").replace(/^Set the price · /, "Price · ");
}

// Questions to start a task's chat with. Scout already has the task in its context.
function starters(task: PlanTask, platform: string): string[] {
  switch (task.kind) {
    case "clarify":
      return ["Draft the questions in formal Spanish", "Which of these could cost us points?"];
    case "eligibility":
      return ["Do we meet this?", "What proof do we attach?", "What if we don’t meet it?"];
    case "document":
      return ["What goes in it?", "Is there a template, and who signs it?", "What usually goes wrong?"];
    case "draft":
      return ["Outline this section", "What do the evaluators reward here?", "What from our profile fits?"];
    case "commitment":
      return ["Which option should we commit to?", "What’s the delivery risk of each option?"];
    case "price":
      return ["What discount is safe?", "Simulate our score at 10%, 15% and 20%", "Where is the abnormally-low line?"];
    case "review":
      return ["What gets bids excluded here?", "Which figures must match across documents?"];
    case "submit":
      return [`How do we submit on ${platform}?`, "What are the signature and file-size rules?"];
  }
}

function topicFor(task: PlanTask, platform: string): ScoutRequest {
  const context = [
    `Task type: ${task.kind}.`,
    task.detail,
    task.facts.length ? `Facts: ${task.facts.map((fact) => `${fact.label}: ${fact.value}`).join("; ")}.` : null,
    task.options.length ? `Scoring: ${task.options.map((option) => `${option.when} → ${option.points} pts`).join("; ")}.` : null,
    task.cite?.page ? `Source: ${task.cite.doc?.toUpperCase() ?? "pliego"} p.${task.cite.page}${task.cite.quote ? ` “${task.cite.quote}”` : ""}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { key: topicKey(task), title: shortTitle(task), context, suggestions: starters(task, platform) };
}

function barLabel(task: PlanTask, status: TaskStatus, overdue: boolean, questionsBy: string | null) {
  if (status === "done" && task.check === "met") {
    return /exempt|not required|no .{0,30}required|no es exigible/i.test(task.detail || "") ? "Not required" : "In your profile";
  }
  if (status === "done") return "✓ Done";
  if (status === "skip") return "Not needed";
  if (overdue) return "Overdue";
  if (status === "doing") return "In progress";
  if (task.kind === "eligibility") return task.check === "missing" ? "! You may not meet this" : "Check";
  if (task.kind === "clarify") return questionsBy ? `Ask by ${SHORT.format(date(questionsBy))}` : "Ask early";
  if (task.kind === "draft") return "Draft";
  if (task.kind === "commitment") return "Decide";
  if (task.kind === "price") return "Price & sign-off";
  if (task.kind === "review") return "Review";
  if (task.kind === "submit") return "Submit";
  return task.conditional ? "If it applies" : "Prepare";
}

// ---------- page ----------

export function BidPlanView({ companyId, me, initialTask, initialView, outline, price, decision, plan, documents, tender }: Props) {
  const [state, update] = usePlanState(companyId, tender.id);
  const [view, setView] = useState<BidView>(initialTask ? "plan" : initialView);
  const [savedPrice] = useStored<SavedPrice>(priceKey(companyId, tender.id));
  const talked = useTalkedAbout(companyId, tender.id);
  const [open, setOpen] = useState<string | null>(initialTask);
  const [chatOpen, setChatOpen] = useState(false);
  const chatRef = useRef<ScoutChatHandle>(null);
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);

  const { done, total } = progress(plan, state);
  const days = tender.deadline ? businessDaysUntil(tender.deadline) : null;
  const closed = !isStillOpen(tender.deadline);
  const tasks = plan.groups.flatMap((group) => group.tasks);
  const missing = tasks.filter((task) => task.kind === "eligibility" && task.check === "missing" && statusOf(task, state) !== "done");
  const overdue = tasks.filter((task) => taskSpan(task, state, plan.days).late);
  const mine = hydrated ? myTasks(tasks, state, plan.days, me.id) : [];

  // Arriving from a to-do: show that task.
  useEffect(() => {
    if (initialTask) document.getElementById(`task-${initialTask}`)?.scrollIntoView({ block: "center" });
  }, [initialTask]);

  function show(id: string) {
    choose("plan");
    setOpen(id);
    requestAnimationFrame(() => document.getElementById(`task-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }

  // Open Scout on a task's chat (or the general one), optionally asking straight away.
  function scout(task: PlanTask | null, question?: string) {
    setChatOpen(true);
    chatRef.current?.show(task ? topicFor(task, tender.platform) : null, question);
  }

  // The tab lives in the URL (?view=price) so a reload or a shared link lands on it.
  function choose(next: BidView) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "plan") url.searchParams.delete("view");
    else url.searchParams.set("view", next);
    url.searchParams.delete("task");
    window.history.replaceState(null, "", url);
  }

  const priceTask = tasks.find((task) => task.kind === "price") ?? null;
  const gaps = outline.sections.reduce((sum, section) => sum + section.gaps.length, 0);

  // Draft tasks are "Write: <criterion>" and commitments "Decide: <criterion>", named like the outline's sections.
  function taskFor(section: OutlineSection) {
    const name = section.title.trim().toLowerCase();
    return (
      tasks.find((task) => (task.kind === "draft" || task.kind === "commitment") && task.title.replace(/^(Write|Decide):\s*/, "").trim().toLowerCase() === name) ??
      null
    );
  }

  function workbenchFor(task: PlanTask): Workbench | null {
    if (task.kind === "price") {
      return {
        label: "Open the price simulator",
        hint:
          savedPrice?.discount !== undefined && tender.budget !== null
            ? `Your price: ${pct(savedPrice.discount)} off · ${EURO.format(tender.budget * (1 - savedPrice.discount))}`
            : "Try discounts against likely rivals and the abnormally-low line",
        onClick: () => choose("price"),
      };
    }
    if (task.kind !== "draft" && task.kind !== "commitment") return null;
    const section = outline.sections.find((item) => taskFor(item)?.id === task.id);
    if (!section) return null;
    return {
      label: "Open it in the proposal outline",
      hint: `${section.write.length} thing${section.write.length === 1 ? "" : "s"} to cover · ${section.gaps.length} to fill in`,
      onClick: () => {
        choose("proposal");
        requestAnimationFrame(() => document.getElementById(`prop-${section.key}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
      },
    };
  }

  const docUrl = (cite: Cite | null) => {
    if (!cite?.doc) return null;
    const doc = documents.find((item) => item.kind === cite.doc);
    return doc ? `${doc.url}${cite.page ? `#page=${cite.page}` : ""}` : null;
  };

  return (
    <ScoutLayout
      open={chatOpen}
      panel={
        hydrated ? (
          <ScoutChat
            ref={chatRef}
            companyId={companyId}
            tenderId={tender.id}
            documents={documents}
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            suggestions={SUGGESTIONS}
          />
        ) : null
      }
    >
      <main className="dec bid">
        <nav className="bid-crumbs" aria-label="Breadcrumb">
          <Link href="/bid">← Bid prep</Link>
          <span aria-hidden="true">·</span>
          <Link href={`/pipeline/${tender.id}`}>Bid / no-bid view</Link>
        </nav>

        <header className="bid-head">
          <div className="dec-title">
            <span className="dec-kicker">{[tender.buyer, `submit on ${tender.platform}`].filter(Boolean).join(" · ")}</span>
            <h1 lang="es" title={tender.title}>
              {tender.title}
            </h1>
            <p className="dec-facts">
              {[tender.budget !== null ? EURO.format(tender.budget) : null, tender.procedure, tender.duration].filter(Boolean).join(" · ")}
              {tender.link ? (
                <>
                  {" · "}
                  <a href={tender.link} target="_blank" rel="noreferrer">
                    Official notice ↗
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <div className="bid-stats">
            <div>
              <span>Deadline</span>
              <b className={closed || (days !== null && days <= 5) ? "bid-deadline bid-deadline-urgent" : "bid-deadline"}>
                {tender.deadline ? `${SHORT.format(date(tender.deadline))}${tender.deadlineTime ? `, ${tender.deadlineTime.slice(0, 5)}` : ""}` : "Not given"}
              </b>
              {days !== null ? <small>{closed ? "Closed" : `${days} business day${days === 1 ? "" : "s"} left`}</small> : null}
            </div>
            <button
              type="button"
              className="dec-ask"
              onClick={() => (chatOpen ? setChatOpen(false) : scout(null))}
              aria-expanded={chatOpen}
            >
              <span aria-hidden="true">✦</span> Ask Scout
            </button>
          </div>
        </header>

        {decision !== "go" ? (
          <p className="dec-note" role="status">
            This tender isn’t marked Interested yet. <Link href={`/pipeline/${tender.id}`}>Decide on the bid / no-bid view</Link>.
          </p>
        ) : null}

        <div className="bid-tabs" role="tablist" aria-label="Bid prep">
          {(
            [
              ["plan", "Plan", hydrated ? `${done} of ${total} done` : `${total} tasks`],
              ["price", "Price", hydrated && savedPrice?.discount !== undefined ? `${pct(savedPrice.discount)} off` : "Simulator"],
              ["proposal", "Proposal", `${outline.sections.length} sections${gaps ? ` · ${gaps} to fill in` : ""}`],
            ] as Array<[BidView, string, string]>
          ).map(([key, label, hint]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`bid-tab-${key}`}
              aria-selected={view === key}
              aria-controls={`bid-view-${key}`}
              onClick={() => choose(key)}
            >
              <b>{label}</b>
              <small>{hint}</small>
            </button>
          ))}
        </div>

        {view === "price" ? (
          <div role="tabpanel" id="bid-view-price" aria-labelledby="bid-tab-price">
            <PriceTab
              price={price}
              companyId={companyId}
              tenderId={tender.id}
              priceHref={docUrl(plan.price?.cite ?? null)}
              onAsk={(question) => scout(priceTask, question)}
            />
          </div>
        ) : null}

        {view === "proposal" ? (
          <div role="tabpanel" id="bid-view-proposal" aria-labelledby="bid-tab-proposal">
            <ProposalOutline
              outline={outline}
              companyId={companyId}
              tenderId={tender.id}
              tenderTitle={tender.title}
              taskFor={taskFor}
              onOpenTask={show}
              onAsk={(section) =>
                scout(taskFor(section), `Help me write the “${section.title}” section: what should it say to score well here, using only what we actually have?`)
              }
            />
          </div>
        ) : null}

        {view === "plan" ? (
          <div role="tabpanel" id="bid-view-plan" aria-labelledby="bid-tab-plan" className="bid-view">
          <YourTasks mine={mine} days={plan.days} groups={plan.groups} onOpen={show} onDone={(id) => update(id, { status: "done" })} />

          <ScoutFlags plan={plan} tasks={tasks} missing={missing} overdue={hydrated ? overdue.length : 0} onScout={scout} onOpen={setOpen} />

          <Timeline
            plan={plan}
            me={me}
            state={state}
            talked={talked}
            hydrated={hydrated}
            open={open}
            platform={tender.platform}
            onToggle={(id) => setOpen(open === id ? null : id)}
            onUpdate={update}
            onScout={scout}
            docUrl={docUrl}
            workbenchFor={workbenchFor}
          />

          <div className="bid-grid">
            {plan.risks.length || plan.notes.length ? (
              <section className="dec-panel">
                <h2 className="dec-label">What could get you excluded</h2>
                <ul className="bid-notes">
                  {plan.risks.map((risk) => (
                    <li key={risk.text}>
                      {risk.text} <CiteLink cite={risk.cite} href={docUrl(risk.cite)} />
                    </li>
                  ))}
                </ul>
                {plan.notes.length ? (
                  <>
                    <h3 className="bid-sub">Scout’s notes from the pliegos</h3>
                    <ul className="bid-notes bid-notes-muted">
                      {plan.notes.map((note) => (
                        <li key={note.text}>{note.text}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>
            ) : null}

            <section className="dec-panel">
              <h2 className="dec-label">
                Price & dates
                <button type="button" className="link-button dec-label-aside" onClick={() => choose("price")}>
                  Price simulator →
                </button>
              </h2>
              {plan.price ? (
                <dl className="bid-facts">
                  {plan.price.explained ? (
                    <div>
                      <dt>How price is scored</dt>
                      <dd>
                        {plan.price.explained} <CiteLink cite={plan.price.cite} href={docUrl(plan.price.cite)} />
                      </dd>
                    </div>
                  ) : null}
                  {plan.price.formula ? (
                    <div>
                      <dt>Formula</dt>
                      <dd className="mono">{plan.price.formula}</dd>
                    </div>
                  ) : null}
                  {plan.price.abnormallyLow ? (
                    <div>
                      <dt>Abnormally low</dt>
                      <dd>{plan.price.abnormallyLow}</dd>
                    </div>
                  ) : null}
                  {plan.price.guarantee ? (
                    <div>
                      <dt>Guarantees</dt>
                      <dd>{plan.price.guarantee}</dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="dec-muted">
                  The price formula is in the PCAP.{" "}
                  <button
                    type="button"
                    className="link-button link-strong"
                    onClick={() => scout(null, "How is price scored in this tender, and what is the abnormally-low threshold?")}
                  >
                    Ask Scout to find it
                  </button>
                </p>
              )}
              {plan.keyDates.length ? (
                <ul className="bid-dates">
                  {plan.keyDates.map((item) => (
                    <li key={item.label}>
                      <span className="mono">{item.date ? SHORT.format(date(item.date)) : "—"}</span>
                      <span>
                        {item.label} <CiteLink cite={item.cite} href={docUrl(item.cite)} />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {plan.afterAward.length || plan.submission ? (
              <section className="dec-panel">
                <h2 className="dec-label">Submitting, and if you win</h2>
                {plan.submission ? <p className="bid-text">{plan.submission}</p> : null}
                {plan.afterAward.length ? (
                  <>
                    <h3 className="bid-sub">Only the winner hands these in, after the award</h3>
                    <ul className="bid-notes bid-notes-muted">
                      {plan.afterAward.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </section>
            ) : null}
          </div>
          </div>
        ) : null}
      </main>
    </ScoutLayout>
  );
}

function CiteLink({ cite, href }: { cite: Cite | null; href: string | null }) {
  if (!cite?.page) return null;
  const label = `${cite.doc ? cite.doc.toUpperCase() : "Pliego"} p.${cite.page}`;
  return href ? (
    <a className="chat-cite" href={href} target="_blank" rel="noreferrer">
      {label}
    </a>
  ) : (
    <span className="chat-cite">{label}</span>
  );
}

// ---------- your tasks in this bid ----------

const DUE = dateFormat({ weekday: true });

export function dueLabel(due: string, today: string, tomorrow: string | undefined, late: boolean) {
  if (late) return `Overdue · was due ${DUE.format(date(due))}`;
  if (due === today) return "Due today";
  if (due === tomorrow) return "Due tomorrow";
  return `Due ${DUE.format(date(due))}`;
}

function YourTasks({
  mine,
  days,
  groups,
  onOpen,
  onDone,
}: {
  mine: ReturnType<typeof myTasks>;
  days: string[];
  groups: BidPlan["groups"];
  onOpen: (id: string) => void;
  onDone: (id: string) => void;
}) {
  const groupOf = (id: string) => groups.find((group) => group.tasks.some((task) => task.id === id))?.label ?? "";
  if (!mine.length) {
    return (
      <p className="bid-mine-empty">
        <b>Your tasks:</b> none yet. Press <span className="bid-avatar bid-avatar-empty bid-avatar-inline">+</span> on a task to take it, and it shows up here and on your Bid prep to-do list.
      </p>
    );
  }
  return (
    <section className="bid-mine" aria-label="Your tasks">
      <h2>
        Your tasks <span className="mono">{mine.length}</span>
      </h2>
      <ul>
        {mine.map(({ task, status, due, late }) => (
          <li key={task.id} className={late ? "bid-mine-late" : undefined}>
            <button type="button" className="bid-check" aria-label={`Mark “${task.title}” as done`} onClick={() => onDone(task.id)} />
            <button type="button" className="bid-mine-name" onClick={() => onOpen(task.id)}>
              <span lang="es">{task.title}</span>
              <small>{groupOf(task.id)}</small>
            </button>
            {status === "doing" ? <span className="bid-mine-status">In progress</span> : null}
            <span className="bid-mine-due">{dueLabel(due, days[0], days[1], late)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- Scout's flags ----------

function ScoutFlags({
  plan,
  tasks,
  missing,
  overdue,
  onScout,
  onOpen,
}: {
  plan: BidPlan;
  tasks: PlanTask[];
  missing: PlanTask[];
  overdue: number;
  onScout: (task: PlanTask | null, question?: string) => void;
  onOpen: (id: string) => void;
}) {
  const clarify = tasks.find((task) => task.kind === "clarify");
  const price = tasks.find((task) => task.kind === "price") ?? null;
  const flags: Array<{ key: string; title: string; body: string; action: string; run: () => void }> = [];
  if (plan.source === "notice") {
    flags.push({
      key: "notice",
      title: "Envelopes not listed yet",
      body: "The tasks come from the requirements and criteria on the procurement platform. Scout can read the tender’s PDFs and tell you what goes in each envelope.",
      action: "What goes in each envelope?",
      run: () => onScout(null, "Read the pliegos and list what goes in each envelope (sobre), with the annex templates and page references."),
    });
  }
  if (plan.clarifications.length && clarify) {
    flags.push({
      key: "clarify",
      title: `${plan.clarifications.length} contradiction${plan.clarifications.length === 1 ? "" : "s"} in the pliegos`,
      body: `Ask the buyer before you commit${plan.questionsBy ? `, by ${SHORT.format(date(plan.questionsBy))}` : ""}. Bidding on the wrong reading can cost points or get you excluded.`,
      action: "Draft the questions",
      run: () => {
        onOpen(clarify.id);
        onScout(clarify, "Draft the clarification questions in formal Spanish, numbered, each citing the page.");
      },
    });
  }
  if (missing.length) {
    flags.push({
      key: "missing",
      title: `You may not meet ${missing.length === 1 ? "a requirement" : `${missing.length} requirements`}`,
      body: missing.map((task) => task.detail || task.title).join(" · "),
      action: "Any way to still bid?",
      run: () => {
        onOpen(missing[0].id);
        onScout(missing[0], "We don't meet this today. Is there any way to still bid: alternative evidence, a UTE partner, or a commitment to obtain it before the contract starts?");
      },
    });
  }
  if (plan.price?.abnormallyLow) {
    flags.push({
      key: "price",
      title: "Watch the abnormally-low line",
      body: "Bids too far below the others get asked to justify their price, and can be rejected.",
      action: "What discount is safe?",
      run: () => {
        if (price) onOpen(price.id);
        onScout(price, "What discount is safe here, given the abnormally-low rule and how many bidders this buyer usually gets?");
      },
    });
  }
  if (overdue) {
    flags.push({
      key: "overdue",
      title: `${overdue} task${overdue === 1 ? "" : "s"} overdue`,
      body: "Move the dates or reassign them so the plan still fits before the deadline.",
      action: "",
      run: () => {},
    });
  }
  if (!flags.length) return null;

  return (
    <section className="bid-flags" aria-label="Scout flagged">
      <h2 className="bid-flags-title">
        <span aria-hidden="true">✦</span> Scout flagged
      </h2>
      <div className="bid-flags-list">
        {flags.slice(0, 4).map((flag) => (
          <article key={flag.key} className="bid-flag">
            <strong>{flag.title}</strong>
            <p>{flag.body}</p>
            {flag.action ? (
              <button type="button" className="link-button link-strong" onClick={flag.run}>
                {flag.action} →
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------- 4a timeline ----------

function Timeline({
  plan,
  me,
  state,
  talked,
  hydrated,
  open,
  platform,
  onToggle,
  onUpdate,
  onScout,
  docUrl,
  workbenchFor,
}: {
  plan: BidPlan;
  me: Me;
  state: PlanState;
  talked: Set<string>;
  hydrated: boolean;
  open: string | null;
  platform: string;
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: TaskState) => void;
  onScout: (task: PlanTask | null, question?: string) => void;
  docUrl: (cite: Cite | null) => string | null;
  workbenchFor: (task: PlanTask) => Workbench | null;
}) {
  const last = plan.days.length - 1;
  const columns = { "--days": plan.days.length } as React.CSSProperties;

  return (
    <section className="bid-plan" aria-label="Plan to the deadline">
      <div className="bid-scroll">
        <div className="bid-table" style={columns}>
          <div className="bid-row bid-row-head">
            <span className="bid-cell-task">Task · source</span>
            <span className="bid-cell-who">Who</span>
            {plan.days.map((day, index) => {
              const value = date(day);
              return (
                <span
                  key={day}
                  className={index === 0 ? "bid-day bid-day-today" : index === last ? "bid-day bid-day-deadline" : "bid-day"}
                  title={index === 0 ? "Today" : index === last ? "Deadline" : undefined}
                >
                  <small>{index === 0 ? "Today" : WEEKDAY[value.getDay()]}</small>
                  <b className="mono">{value.getDate()}</b>
                </span>
              );
            })}
          </div>

          {plan.groups.map((group) => (
            <div key={group.key} className="bid-group" role="rowgroup">
              <div className="bid-row bid-row-group">
                <span>
                  <b>{group.label}</b>
                  {group.points ? <span className="mono"> · {group.points} pts</span> : null}
                  {group.hint && group.hint !== group.label ? (
                    <small lang="es" title={group.hint}>
                      {group.hint}
                    </small>
                  ) : null}
                </span>
              </div>

              {group.tasks.map((task) => {
                const saved = state[task.id] || {};
                const status = statusOf(task, state);
                const span = taskSpan(task, state, plan.days);
                const late = hydrated && span.late;
                const expanded = open === task.id;
                const chatted = talked.has(topicKey(task));
                const meta = [
                  task.cite?.page ? `${task.cite.doc ? task.cite.doc.toUpperCase() : "Pliego"} p.${task.cite.page}` : null,
                  task.points ? `${task.points} pts` : null,
                  task.conditional ? "If it applies" : null,
                  task.check === "missing" ? "Not in your profile" : null,
                ].filter(Boolean);
                const isMine = saved.ownerId === me.id;
                return (
                  <div key={task.id} id={`task-${task.id}`} className={`bid-task bid-task-${status}${expanded ? " bid-task-open" : ""}`}>
                    <div className="bid-row">
                      <div className="bid-cell-task">
                        <button
                          type="button"
                          className={`bid-check bid-check-${status}`}
                          aria-label={status === "done" ? `Mark “${task.title}” as not done` : `Mark “${task.title}” as done`}
                          onClick={() => onUpdate(task.id, { status: status === "done" ? "todo" : "done" })}
                        >
                          {status === "done" ? "✓" : ""}
                        </button>
                        <button
                          type="button"
                          className="bid-task-name"
                          aria-expanded={expanded}
                          title={task.title}
                          onClick={() => onToggle(task.id)}
                        >
                          <span lang="es">{task.title}</span>
                          {meta.length || chatted ? (
                            <small>
                              {meta.join(" · ")}
                              {chatted ? (
                                <em className="bid-chatted">
                                  {meta.length ? " · " : ""}✦ chat
                                </em>
                              ) : null}
                            </small>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          className="bid-chevron"
                          aria-expanded={expanded}
                          aria-label={expanded ? `Collapse “${task.title}”` : `Expand “${task.title}”`}
                          onClick={() => onToggle(task.id)}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                            <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                      </div>
                      <span className="bid-cell-who">
                        {saved.owner ? (
                          <span className={isMine ? "bid-avatar bid-avatar-me" : "bid-avatar"} title={isMine ? "You" : saved.owner}>
                            {initials(saved.owner)}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="bid-avatar bid-avatar-empty"
                            onClick={() => onUpdate(task.id, { ownerId: me.id, owner: me.name })}
                            aria-label={`Assign “${task.title}” to me`}
                            title="Assign to me"
                          >
                            +
                          </button>
                        )}
                      </span>
                      <span
                        className={`bid-bar bid-bar-${task.kind} bid-bar-${status}${task.check === "missing" && status !== "done" ? " bid-bar-missing" : ""}${late ? " bid-bar-late" : ""}`}
                        style={{ gridColumn: `${span.start + 3} / ${span.end + 4}` }}
                        onClick={() => onToggle(task.id)}
                      >
                        {barLabel(task, status, late, plan.questionsBy)}
                      </span>
                      <span className="bid-due">{status === "done" ? "Done" : late ? "Overdue" : `By ${SHORT.format(date(plan.days[span.end]))}`}</span>
                    </div>

                    {expanded ? (
                      <TaskDetail
                        task={task}
                        me={me}
                        saved={saved}
                        status={status}
                        days={plan.days}
                        start={span.start}
                        end={span.end}
                        chatted={chatted}
                        questions={starters(task, platform)}
                        onUpdate={(patch) => onUpdate(task.id, patch)}
                        onScout={(question) => onScout(task, question)}
                        href={docUrl(task.cite)}
                        workbench={workbenchFor(task)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <p className="bid-foot">
        {plan.source === "checklist" ? "Every task links to the page of the pliego it comes from. " : ""}Progress is saved in this browser.
      </p>
    </section>
  );
}

type Workbench = { label: string; hint: string; onClick: () => void };

function TaskDetail({
  task,
  me,
  saved,
  status,
  days,
  start,
  end,
  chatted,
  questions,
  onUpdate,
  onScout,
  href,
  workbench,
}: {
  task: PlanTask;
  me: Me;
  saved: TaskState;
  status: TaskStatus;
  days: string[];
  start: number;
  end: number;
  chatted: boolean;
  questions: string[];
  onUpdate: (patch: TaskState) => void;
  onScout: (question?: string) => void;
  href: string | null;
  workbench: Workbench | null;
}) {
  // A parsed scoring table replaces the sentence it came from.
  const lines = task.options.length ? [] : (task.detail || "").split("\n").filter(Boolean);
  const span = end - start + 1;
  return (
    <div className="bid-detail">
      <div className="bid-detail-main">
        {workbench ? (
          <button type="button" className="bid-workbench" onClick={workbench.onClick}>
            <b>{workbench.label} →</b>
            <span>{workbench.hint}</span>
          </button>
        ) : null}
        <dl className="bid-detail-facts">
          {task.facts.map((fact) => (
            <div
              key={fact.label}
              className={["bid-fact", fact.tone ? `bid-fact-${fact.tone}` : "", fact.value.length > 48 ? "bid-fact-wide" : ""].filter(Boolean).join(" ")}
            >
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
          <div className="bid-fact">
            <dt>Time planned</dt>
            <dd>
              {span} business day{span === 1 ? "" : "s"} · due {SHORT.format(date(days[end]))}
            </dd>
          </div>
        </dl>

        {lines.length ? (
          task.kind === "clarify" ? (
            <ol className="bid-detail-list">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ol>
          ) : (
            <div className="bid-detail-text">
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )
        ) : null}

        {task.options.length ? (
          <table className="bid-options">
            <thead>
              <tr>
                <th scope="col">If you commit to</th>
                <th scope="col">Points</th>
              </tr>
            </thead>
            <tbody>
              {task.options.map((option) => (
                <tr key={option.when}>
                  <td>{option.when}</td>
                  <td className="mono">{option.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {task.cite?.quote ? (
          <figure className="bid-quote">
            <blockquote lang="es">“{task.cite.quote}”</blockquote>
            <figcaption>
              <CiteLink cite={task.cite} href={href} />
            </figcaption>
          </figure>
        ) : null}

        <div className="bid-ask">
          <span className="bid-ask-label">
            <span aria-hidden="true">✦</span> Ask Scout
          </span>
          {questions.map((question) => (
            <button key={question} type="button" className="bid-ask-chip" onClick={() => onScout(question)}>
              {question}
            </button>
          ))}
          <button type="button" className="bid-ask-open" onClick={() => onScout()}>
            {chatted ? "Open this task’s chat →" : "Ask something else →"}
          </button>
        </div>
      </div>

      <div className="bid-detail-side">
        <div className="bid-seg" role="group" aria-label="Status">
          {(["todo", "doing", "done", "skip"] as TaskStatus[]).map((value) => (
            <button key={value} type="button" aria-pressed={status === value} onClick={() => onUpdate({ status: value })}>
              {STATUS_LABEL[value]}
            </button>
          ))}
        </div>
        <div className="bid-field">
          <span>Who</span>
          {saved.ownerId === me.id ? (
            <div className="bid-owner">
              <span className="bid-avatar bid-avatar-me" aria-hidden="true">
                {initials(me.name)}
              </span>
              <span>You · it’s on your to-do list</span>
              <button type="button" className="link-button" onClick={() => onUpdate({ ownerId: undefined, owner: undefined })}>
                Unassign
              </button>
            </div>
          ) : (
            <div className="bid-owner">
              {saved.owner ? <span className="bid-owner-other">{saved.owner}</span> : null}
              <button type="button" className="bid-assign" onClick={() => onUpdate({ ownerId: me.id, owner: me.name })}>
                {saved.owner ? "Take it over" : "Assign to me"}
              </button>
            </div>
          )}
        </div>
        <div className="bid-field-row">
          <label className="bid-field">
            <span>Start</span>
            <select
              value={days[start]}
              onChange={(event) => onUpdate({ start: event.target.value, end: days[Math.max(days.indexOf(event.target.value), end)] })}
            >
              {days.map((day) => (
                <option key={day} value={day}>
                  {SHORT.format(date(day))}
                </option>
              ))}
            </select>
          </label>
          <label className="bid-field">
            <span>Due</span>
            <select
              value={days[end]}
              onChange={(event) => onUpdate({ end: event.target.value, start: days[Math.min(start, days.indexOf(event.target.value))] })}
            >
              {days.map((day) => (
                <option key={day} value={day}>
                  {SHORT.format(date(day))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="bid-field">
          <span>Notes</span>
          <textarea rows={3} value={saved.note ?? ""} placeholder="Anything the team should know" onChange={(event) => onUpdate({ note: event.target.value })} />
        </label>
      </div>
    </div>
  );
}
