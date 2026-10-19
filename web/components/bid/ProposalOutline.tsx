"use client";

import { Fragment, useState } from "react";
import { outlineMarkdown, type OutlineSection, type ProposalOutline as Outline } from "@/lib/draft-outline";
import type { ProposalDraft } from "@/lib/proposal-draft";
import { useStored } from "./plan-store";

// The Proposal tab: one section per scored criterion (most points first) with what to
// write, what we already hold and the [ADD: …] gaps, plus an optional AI first draft
// written on the same outline. The draft is kept in this browser.

type SavedDraft = ProposalDraft & { language: "es" | "en"; at: string };

const KIND: Record<OutlineSection["kind"], string> = {
  overview: "Opening",
  judgement: "Judged by the evaluators",
  formula: "Scored by formula",
};

type Props = {
  outline: Outline;
  companyId: string;
  tenderId: string;
  tenderTitle: string;
  taskFor: (section: OutlineSection) => { id: string; title: string } | null;
  onOpenTask: (id: string) => void;
  onAsk: (section: OutlineSection) => void;
};

export function ProposalOutline({ outline, companyId, tenderId, tenderTitle, taskFor, onOpenTask, onAsk }: Props) {
  const [draft, saveDraft] = useStored<SavedDraft>(`bidmagnet:draft:${companyId}:${tenderId}`);
  const [language, setLanguage] = useState<"es" | "en">(draft?.language ?? "es");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const total = outline.points.judgement + outline.points.formula + outline.points.price;
  const gaps = outline.sections.reduce((sum, section) => sum + section.gaps.length, 0);
  const drafted = new Map((draft?.sections ?? []).map((section) => [section.key, section]));

  async function write() {
    setWriting(true);
    setError(null);
    try {
      const response = await fetch(`/api/tenders/${tenderId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<ProposalDraft> & { error?: string };
      if (!response.ok || body.error || !body.sections) throw new Error(body.error || "Couldn’t write the draft right now. Try again in a minute.");
      saveDraft({
        sections: body.sections,
        cautions: body.cautions ?? [],
        language,
        at: new Date().toISOString(),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t write the draft right now.");
    } finally {
      setWriting(false);
    }
  }

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1800);
    } catch {
      setError("Couldn’t copy: your browser blocked the clipboard.");
    }
  }

  const draftMarkdown = () =>
    [`# ${tenderTitle}`, "", ...(draft?.sections ?? []).flatMap((section) => [`## ${section.title}`, "", section.text, ""])].join("\n");

  return (
    <div className="prop">
      <section className="dec-panel prop-head" aria-label="Proposal outline">
        <div className="prop-head-top">
          <div>
            <h2 className="dec-label">Technical proposal outline</h2>
            <p className="prop-sub">
              {outline.sections.length} section
              {outline.sections.length === 1 ? "" : "s"}, most points first
              {gaps ? ` · ${gaps} thing${gaps === 1 ? "" : "s"} only you can fill in` : ""}
            </p>
          </div>
          <div className="prop-actions">
            <button type="button" className="bid-assign" onClick={() => copy("outline", outlineMarkdown(tenderTitle, outline))}>
              {copied === "outline" ? "Copied" : "Copy outline"}
            </button>
            <div className="prop-write">
              <select value={language} onChange={(event) => setLanguage(event.target.value as "es" | "en")} aria-label="Draft language">
                <option value="es">Spanish</option>
                <option value="en">English</option>
              </select>
              <button type="button" className="dec-ask" onClick={write} disabled={writing}>
                <span aria-hidden="true">✦</span> {writing ? "Writing…" : draft ? "Write it again" : "Write a first draft"}
              </button>
            </div>
          </div>
        </div>

        {total > 0 ? (
          <div className="prop-points" aria-label="How the points split">
            <div className="prop-bar">
              {(["judgement", "formula", "price"] as const).map((part) =>
                outline.points[part] ? <span key={part} className={`prop-bar-${part}`} style={{ flex: outline.points[part] }} /> : null,
              )}
            </div>
            <div className="prop-bar-legend">
              {outline.points.judgement ? (
                <span>
                  <i className="prop-bar-judgement" /> Judgement <b className="mono">{outline.points.judgement} pts</b>
                </span>
              ) : null}
              {outline.points.formula ? (
                <span>
                  <i className="prop-bar-formula" /> Formula <b className="mono">{outline.points.formula} pts</b>
                </span>
              ) : null}
              {outline.points.price ? (
                <span>
                  <i className="prop-bar-price" /> Price <b className="mono">{outline.points.price} pts</b>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {outline.note ? <p className="prop-note">{outline.note}</p> : null}
        {writing ? <p className="dec-muted">Scout is writing each section from your profile and the pliegos. This takes about half a minute.</p> : null}
        {error ? (
          <p className="dec-error" role="alert">
            {error}
          </p>
        ) : null}
        {draft ? (
          <div className="prop-draft-bar">
            <span>
              First draft in {draft.language === "es" ? "Spanish" : "English"}, written{" "}
              {new Date(draft.at).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}
              . It never invents facts: fill every highlighted <mark className="prop-add">[ADD: …]</mark>.
            </span>
            <button type="button" className="link-button" onClick={() => copy("draft", draftMarkdown())}>
              {copied === "draft" ? "Copied" : "Copy the whole draft"}
            </button>
            <button type="button" className="link-button" onClick={() => saveDraft(null)}>
              Clear it
            </button>
          </div>
        ) : null}
        {draft?.cautions.length ? (
          <ul className="bid-notes prop-cautions">
            {draft.cautions.map((caution) => (
              <li key={caution}>{caution}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="prop-body">
        <nav className="prop-toc" aria-label="Sections">
          <ol>
            {outline.sections.map((section) => (
              <li key={section.key}>
                <a href={`#prop-${section.key}`}>
                  <span lang="es">{section.title}</span>
                  {section.points !== null ? <b className="mono">{section.points}</b> : null}
                </a>
              </li>
            ))}
          </ol>
          {outline.attach.length ? <a href="#prop-attach">Attach with the bid</a> : null}
        </nav>

        <div className="prop-sections">
          {outline.sections.map((section) => {
            const task = taskFor(section);
            const text = drafted.get(section.key)?.text;
            return (
              <article key={section.key} id={`prop-${section.key}`} className={`dec-panel prop-section prop-section-${section.kind}`}>
                <header className="prop-section-head">
                  <span className="prop-kind">{KIND[section.kind]}</span>
                  <h3 lang="es">{section.title}</h3>
                  {section.points !== null ? <span className="prop-pts mono">{section.points} pts</span> : null}
                </header>
                {section.howScored ? (
                  <p className="prop-how">
                    {section.howScored}
                    {section.cite?.page ? (
                      <>
                        {" "}
                        {section.cite.href ? (
                          <a className="chat-cite" href={section.cite.href} target="_blank" rel="noreferrer">
                            {section.cite.label}
                          </a>
                        ) : (
                          <span className="chat-cite">{section.cite.label}</span>
                        )}
                      </>
                    ) : null}
                  </p>
                ) : null}

                <div className="prop-cols">
                  <div>
                    <h4>What to write</h4>
                    <ul>
                      {section.write.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                  {section.evidence.length ? (
                    <div className="prop-have">
                      <h4>You already have</h4>
                      <ul>
                        {section.evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="prop-gaps">
                    <h4>Only you can fill in</h4>
                    <ul>
                      {section.gaps.map((item) => (
                        <li key={item}>{gapLabel(item)}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {text ? (
                  <div className="prop-text">
                    <div className="prop-text-head">
                      <span>First draft</span>
                      <button type="button" className="link-button" onClick={() => copy(section.key, text)}>
                        {copied === section.key ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <Highlighted text={text} />
                  </div>
                ) : null}

                <footer className="prop-section-foot">
                  {task ? (
                    <button type="button" className="link-button" onClick={() => onOpenTask(task.id)}>
                      Its task in the plan →
                    </button>
                  ) : null}
                  <button type="button" className="bid-ask-open" onClick={() => onAsk(section)}>
                    <span aria-hidden="true">✦</span> Ask Scout about this section
                  </button>
                </footer>
              </article>
            );
          })}

          {outline.attach.length ? (
            <section id="prop-attach" className="dec-panel">
              <h2 className="dec-label">Attach with the bid</h2>
              <ul className="bid-notes" lang="es">
                {outline.attach.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// "[ADD: your commitment for "<title>"]" -> "The value you commit to": the title is right above.
function gapLabel(gap: string) {
  const text = gap.replace(/^\[ADD:\s*/, "").replace(/\]$/, "");
  return /^your commitment for "/.test(text) ? "The value you commit to, and its proof" : text[0].toUpperCase() + text.slice(1);
}

// Draft text with its [ADD: …] placeholders highlighted.
function Highlighted({ text }: { text: string }) {
  return (
    <div className="prop-prose">
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index}>
          {paragraph.split(/(\[ADD:[^\]]*\])/).map((part, at) =>
            part.startsWith("[ADD:") ? (
              <mark key={at} className="prop-add">
                {part}
              </mark>
            ) : (
              <Fragment key={at}>{part}</Fragment>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
