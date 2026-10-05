"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { elapsedLabel, savedResearchJob, useNow, useResearchJob } from "@/components/company/useResearchJob";
import {
  mergeResearch,
  readProgress,
  STEPS,
  stepPatch,
  writeProgress,
  type OnboardingProgress,
  type Sources,
  type StepId,
} from "@/lib/onboarding";
import {
  applyDocumentExtraction,
  applyImportSuggestion,
  companyFromRow,
  companyPatchPayload,
  companyWritePayload,
} from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import {
  EMPTY_COMPANY,
  type CompanyDocument,
  type CompanyProfile,
  type DocumentExtraction,
  type ImportSuggestion,
  type MatchReason,
} from "@/lib/types";
import { DocumentsStep } from "./DocumentsStep";
import { CertificationsStep, FinancesStep, RegistrationsStep, WhatStep, WhereStep, type StepProps } from "./steps";

type OnboardingProps = {
  initialCompany: CompanyProfile | null;
  initialDocuments: CompanyDocument[];
  userId: string;
  // /welcome?replay=1: walk through the steps again with your current profile (for testing).
  replay?: boolean;
};

function withProtocol(website: string) {
  const trimmed = website.trim();
  return trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function hostOf(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

export function Onboarding({ initialCompany, initialDocuments, userId, replay = false }: OnboardingProps) {
  const [created, setCreated] = useState<CompanyProfile | null>(null);

  if (created) return <Flow initial={created} userId={userId} documents={replay ? initialDocuments : []} fresh />;
  if (initialCompany && replay) {
    return (
      <Frame>
        <StartForm existing={initialCompany} onCreated={setCreated} />
      </Frame>
    );
  }
  if (initialCompany) return <ResumeGate company={initialCompany} userId={userId} documents={initialDocuments} />;
  return (
    <Frame>
      <StartForm onCreated={setCreated} />
    </Frame>
  );
}

// Page chrome: logo, optional progress and a right-hand slot.
function Frame({ progress, right, children }: { progress?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="welcome-page">
      <header className="welcome-top ob-top">
        <span className="product-name">
          <span className="brand-mark" aria-hidden="true" />
          <span>BidMagnet</span>
        </span>
        <div className="ob-top-center">{progress}</div>
        <div className="ob-top-right">{right}</div>
      </header>
      <main className="ob-main">{children}</main>
    </div>
  );
}

// First screen: name and website. With an existing profile (replay) it updates it instead.
function StartForm({ existing, onCreated }: { existing?: CompanyProfile; onCreated: (company: CompanyProfile) => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [website, setWebsite] = useState(existing?.website_url.replace(/^https?:\/\//, "") ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter your company's name.");
      return;
    }
    setPending(true);
    setError("");
    const table = createClient().from("companies");
    const now = new Date().toISOString();
    const { data, error: insertError } = existing?.id
      ? await table
          .update(companyPatchPayload({ name, website_url: withProtocol(website) }, now))
          .eq("id", existing.id)
          .select("*")
          .single()
      : await table
          .insert(companyWritePayload({ ...EMPTY_COMPANY, name, website_url: withProtocol(website) }, now))
          .select("*")
          .single();
    if (insertError || !data) {
      setPending(false);
      setError(insertError?.message || "We couldn't create your profile. Try again.");
      return;
    }
    onCreated(companyFromRow(data));
  }

  return (
    <section className="welcome-card welcome-enter ob-centered">
      <p className="welcome-eyebrow">Welcome to BidMagnet</p>
      <h1>Let&apos;s find the tenders you can win.</h1>
      <p className="welcome-lede">
        Tell us who you are. We&apos;ll research the rest from your website and public records, then
        walk you through it.
      </p>
      <form className="welcome-form" onSubmit={submit}>
        <label className="welcome-field">
          <span>Company name</span>
          <input autoFocus autoComplete="organization" placeholder="Bitácora Software" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="welcome-field">
          <span>Website</span>
          <input inputMode="url" autoComplete="url" placeholder="bitacora.es" value={website} onChange={(event) => setWebsite(event.target.value)} />
        </label>
        {error ? (
          <p className="welcome-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="welcome-button" disabled={pending}>
          {pending ? "Setting up…" : "Continue"}
          <span aria-hidden="true">→</span>
        </button>
      </form>
      <p className="welcome-fineprint">
        {website.trim()
          ? "Takes about two minutes. You check every fact before it's used."
          : "No website? Continue and fill in your profile yourself."}
      </p>
    </section>
  );
}

const noop = () => () => {};

// After a reload: resume unfinished onboarding, otherwise there's nothing to do here.
function ResumeGate({ company, userId, documents }: { company: CompanyProfile; userId: string; documents: CompanyDocument[] }) {
  const router = useRouter();
  const raw = useSyncExternalStore(
    noop,
    () => {
      try {
        return company.id ? localStorage.getItem(`bidmagnet:onboarding:${company.id}`) : null;
      } catch {
        return null;
      }
    },
    () => null,
  );
  useEffect(() => {
    const progress = company.id ? readProgress(company.id) : null;
    if (!progress || progress.completed) router.replace("/company");
  }, [company.id, router]);

  let progress: OnboardingProgress | null = null;
  try {
    progress = raw ? (JSON.parse(raw) as OnboardingProgress) : null;
  } catch {
    progress = null;
  }
  if (!progress || progress.completed) return null;
  return <Flow initial={company} userId={userId} documents={documents} resume={progress} />;
}

type StepCopy = { title: (found: boolean) => string; lede: (host: string, found: boolean) => string; later: string };

const COPY: Record<StepId, StepCopy> = {
  what: {
    title: (found) => (found ? "Here's how we'd describe you" : "What does your company do?"),
    lede: (host, found) =>
      found ? `We filled this in from ${host}. Change anything that's off.` : "This decides which tenders you see.",
    later: "Skipping this leaves your feed nearly empty.",
  },
  where: {
    title: () => "Where do you want to work?",
    lede: () => "Tenders in your regions rank higher. Sizes outside your range are hidden.",
    later: "Skipping this shows tenders from all of Spain, at every size.",
  },
  finances: {
    title: () => "What was your best year?",
    lede: () => "Two numbers buyers check before anything else.",
    later: "Skipping this means we can't check solvency rules for you.",
  },
  registrations: {
    title: () => "Are you in ROLECE?",
    lede: () => "Spain's official register of public contractors. Being in it saves most of the paperwork on every bid.",
    later: "Skipping this means we can't flag tenders that need it.",
  },
  certifications: {
    title: () => "Which certificates do you hold?",
    lede: () => "Many IT tenders ask for ISO 27001 or ENS. Tick what you have; the proof can come later.",
    later: "Skipping this means we can't flag tenders that ask for them.",
  },
  documents: {
    title: () => "Got the paperwork handy?",
    lede: () => "Drop your certificates or ROLECE extract. We read them and you check the result.",
    later: "You can add documents any time from your company page.",
  },
};

const SETUP_PHRASES = (host: string) => [
  "Configuring your setup…",
  "Creating your workspace…",
  `Reading ${host}…`,
  "Finding your legal name and NIF…",
  "Checking the official company register…",
  "Looking for ISO and ENS certificates…",
  "Matching your services to tender categories…",
  "Picking the words buyers use…",
  "Checking every fact against its source…",
  "Tuning your tender matches…",
];

type FlowProps = {
  initial: CompanyProfile;
  userId: string;
  documents: CompanyDocument[];
  fresh?: boolean;
  resume?: OnboardingProgress;
};

type Matches = { total: number; top: Array<{ tender_id: string; title: string; buyer_name: string | null; score: number }> };

function Flow({ initial, userId, documents, fresh = false, resume }: FlowProps) {
  const router = useRouter();
  const companyId = initial.id!;
  const website = initial.website_url;
  const host = hostOf(website);

  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [touched, setTouched] = useState<Set<keyof CompanyProfile>>(new Set());
  const [sources, setSources] = useState<Sources>({});
  const [review, setReview] = useState<ImportSuggestion[]>([]);
  const [foundCount, setFoundCount] = useState<number | null>(null);
  const [phase, setPhase] = useState<"setup" | "steps" | "finish">(resume || !website ? "steps" : "setup");
  const [step, setStep] = useState(resume?.step ?? 0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [deferred, setDeferred] = useState<StepId[]>(resume?.deferred ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [matches, setMatches] = useState<Matches | null>(null);
  // Research runs for new companies, or resumes when a job is still in flight after a reload.
  const [researchOn] = useState(() => Boolean(website) && (fresh || Boolean(savedResearchJob(companyId))));

  const draftRef = useRef(draft);
  const touchedRef = useRef(touched);
  useEffect(() => {
    draftRef.current = draft;
    touchedRef.current = touched;
  });

  const saveFields = useCallback(
    async (patch: Partial<CompanyProfile>) => {
      if (!Object.keys(patch).length) return true;
      const { error: saveError } = await createClient()
        .from("companies")
        .update(companyPatchPayload(patch, new Date().toISOString()))
        .eq("id", companyId);
      if (saveError) {
        setError(`That didn't save: ${saveError.message}`);
        return false;
      }
      setSaved((current) => ({ ...current, ...patch }));
      return true;
    },
    [companyId],
  );

  const job = useResearchJob(companyId, website, {
    enabled: researchOn,
    onDone: (result) => {
      const merged = mergeResearch(draftRef.current, touchedRef.current, result);
      setDraft(merged.next);
      setSources((current) => ({ ...current, ...merged.sources }));
      setReview(merged.review);
      setFoundCount(merged.found);
      void saveFields(merged.patch);
      // Show "Found N facts" for a moment, then start the steps.
      window.setTimeout(() => setPhase((current) => (current === "setup" ? "steps" : current)), 1100);
    },
  });
  const researching = job.state.kind === "running";
  const now = useNow(researching);
  const elapsed = job.state.kind === "running" ? now - job.state.startedAt : 0;

  function set<K extends keyof CompanyProfile>(field: K, value: CompanyProfile[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setTouched((current) => new Set(current).add(field));
  }

  function acceptSuggestion(suggestion: ImportSuggestion) {
    setDraft((current) => applyImportSuggestion(current, suggestion));
    setTouched((current) => new Set(current).add(suggestion.field));
    setSources((current) => ({ ...current, [suggestion.field]: [suggestion] }));
    setReview((current) => current.filter((item) => item !== suggestion));
  }

  async function confirmDocument(extraction: DocumentExtraction) {
    const next = applyDocumentExtraction(draftRef.current, extraction);
    setDraft(next);
    const patch: Partial<CompanyProfile> = {};
    for (const key of ["certifications", "rolece_status", "rolece_last_verified_at", "classification_status", "classification_codes"] as const) {
      if (JSON.stringify(next[key]) !== JSON.stringify(draftRef.current[key])) Object.assign(patch, { [key]: next[key] });
    }
    return saveFields(patch);
  }

  const current = STEPS[step];

  async function advance(later: boolean) {
    if (saving) return;
    setSaving(true);
    setError("");
    const ok = await saveFields(stepPatch(current.id, saved, draft));
    setSaving(false);
    if (!ok) return;
    const nextDeferred = later
      ? [...new Set([...deferred, current.id])]
      : deferred.filter((id) => id !== current.id);
    setDeferred(nextDeferred);
    if (step === STEPS.length - 1) {
      writeProgress(companyId, { step, deferred: nextDeferred, completed: true });
      setPhase("finish");
      void loadMatches();
    } else {
      writeProgress(companyId, { step: step + 1, deferred: nextDeferred, completed: false });
      setDirection(1);
      setStep(step + 1);
    }
  }

  function back() {
    if (step === 0) return;
    setDirection(-1);
    setStep(step - 1);
  }

  function goTo(index: number) {
    if (index === step) return;
    setDirection(index > step ? 1 : -1);
    setStep(index);
  }

  async function loadMatches() {
    const { data } = await createClient().rpc("match_tenders", { p_company: companyId, p_limit: 1000 });
    const rows = ((data as Array<{ tender_id: string; title: string; buyer_name: string | null; score: number; reasons: MatchReason[] }>) || []);
    setMatches({ total: rows.length, top: rows.slice(0, 3) });
  }

  async function saveAndExit() {
    await saveFields(stepPatch(current.id, saved, draft));
    writeProgress(companyId, { step, deferred, completed: false });
    router.push("/company");
  }

  // Enter continues (except while typing a tag or in a textarea); Escape goes back.
  const advanceRef = useRef(advance);
  const backRef = useRef(back);
  useEffect(() => {
    advanceRef.current = advance;
    backRef.current = back;
  });
  useEffect(() => {
    if (phase !== "steps") return;
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void advanceRef.current(false);
      } else if (event.key === "Enter" && !event.shiftKey) {
        if (target.tagName === "TEXTAREA" || target.tagName === "BUTTON" || target.closest("[data-enter-ignore]")) return;
        event.preventDefault();
        void advanceRef.current(false);
      } else if (event.key === "Escape" && target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
        backRef.current();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  // ---------- setup: research running ----------
  if (phase === "setup") {
    const phrases = SETUP_PHRASES(host);
    const index = Math.floor(elapsed / 3_500) % phrases.length;
    const done = job.state.kind === "done";
    const failed = job.state.kind === "error";
    const bar = 92 * (1 - Math.exp(-elapsed / 90_000));
    return (
      <Frame>
        <section className="welcome-card welcome-research ob-centered" aria-live="polite">
          <div className={done ? "research-orb research-orb-done" : "research-orb"} aria-hidden="true">
            <span className="research-ring" />
            <span className="research-ring research-ring-2" />
            <span className="research-ring research-ring-3" />
            <span className="research-core">{done ? "✓" : host.charAt(0).toUpperCase()}</span>
          </div>
          {failed ? (
            <>
              <h1>We couldn&apos;t read {host}.</h1>
              <p className="welcome-lede">That&apos;s fine. You can fill everything in yourself; it takes a few minutes.</p>
              <p className="ob-error-detail">{job.state.kind === "error" ? job.state.message : ""}</p>
              <div className="welcome-actions">
                <button type="button" className="welcome-button" onClick={() => setPhase("steps")}>
                  Continue <span aria-hidden="true">→</span>
                </button>
                <button type="button" className="welcome-link" onClick={job.retry}>
                  Try again
                </button>
              </div>
            </>
          ) : done ? (
            <>
              <h1>Found {foundCount ?? 0} facts about you.</h1>
              <p className="welcome-lede">Let&apos;s check them together.</p>
            </>
          ) : (
            <>
              <h1>Setting up {initial.name}</h1>
              <p className="research-step" key={index}>
                {phrases[index]}
              </p>
              <div className="research-bar research-bar-progress" aria-hidden="true">
                <span style={{ width: `${bar}%` }} />
              </div>
              <p className="welcome-fineprint ob-mono">{elapsedLabel(elapsed)} · usually 1–3 minutes</p>
              {elapsed > 8_000 ? (
                <button type="button" className="ob-start-now" onClick={() => setPhase("steps")}>
                  Start now — we&apos;ll fill things in as we find them
                </button>
              ) : null}
            </>
          )}
        </section>
      </Frame>
    );
  }

  // ---------- finish ----------
  if (phase === "finish") {
    const leftForLater = STEPS.filter((item) => deferred.includes(item.id));
    return (
      <Frame
        progress={<Progress step={STEPS.length} onJump={() => {}} complete />}
      >
        <section className="welcome-card welcome-enter ob-finish">
          <p className="welcome-eyebrow">All set</p>
          <h1>
            {matches === null
              ? "Finding your tenders…"
              : matches.total
                ? `${matches.total} open tenders match you right now.`
                : "You're set up."}
          </h1>
          <p className="welcome-lede">
            {matches && !matches.total
              ? "Nothing open matches yet. New tenders arrive every morning, and you can widen your profile any time."
              : "Your profile is ready. Here are the best matches to start with."}
          </p>

          {matches?.top.length ? (
            <ol className="ob-top-matches">
              {matches.top.map((tender) => (
                <li key={tender.tender_id}>
                  <span className="mono">{tender.score}</span>
                  <span>
                    <strong>{tender.title}</strong>
                    <small>{tender.buyer_name}</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {leftForLater.length ? (
            <p className="ob-later-list">
              Left for later: {leftForLater.map((item) => item.label).join(", ")}. You&apos;ll find them on your company page.
            </p>
          ) : null}

          <div className="welcome-actions">
            <button type="button" className="welcome-button" onClick={() => router.push("/company")}>
              Open my company page <span aria-hidden="true">→</span>
            </button>
            <Link className="welcome-link" href="/discover">
              See all tenders
            </Link>
          </div>
        </section>
      </Frame>
    );
  }

  // ---------- steps ----------
  const props: StepProps = { draft, set, sources, researching, review, onUseSuggestion: acceptSuggestion };
  const stepFields = current.fields;
  const prefilled = stepFields.some((field) => sources[field]?.length);
  const copy = COPY[current.id];

  return (
    <Frame
      progress={<Progress step={step} onJump={goTo} deferred={deferred} />}
      right={
        researching ? (
          <span className="ob-pill" role="status">
            <span className="spinner" aria-hidden="true" /> Reading {host} · {elapsedLabel(elapsed)}
          </span>
        ) : job.state.kind === "error" ? (
          <button type="button" className="ob-pill ob-pill-warn" onClick={job.retry}>
            Couldn&apos;t read your site · Retry
          </button>
        ) : (
          <button type="button" className="text-button" onClick={() => void saveAndExit()}>
            Save and exit
          </button>
        )
      }
    >
      <section className="ob-column">
        <div key={current.id} className={direction === 1 ? "ob-step ob-step-forward" : "ob-step ob-step-back"}>
          <p className="welcome-eyebrow">
            {step + 1} / {STEPS.length} · {current.label}
          </p>
          <h1 className="ob-title">{copy.title(prefilled)}</h1>
          <p className="ob-lede">{copy.lede(host, prefilled)}</p>

          <div className="ob-blocks">
            {current.id === "what" ? <WhatStep {...props} /> : null}
            {current.id === "where" ? <WhereStep {...props} /> : null}
            {current.id === "finances" ? <FinancesStep {...props} /> : null}
            {current.id === "registrations" ? <RegistrationsStep {...props} /> : null}
            {current.id === "certifications" ? <CertificationsStep {...props} /> : null}
            {current.id === "documents" ? (
              <DocumentsStep companyId={companyId} userId={userId} initial={documents} onConfirmed={confirmDocument} />
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="welcome-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="ob-footer">
          {step > 0 ? (
            <button type="button" className="ob-back" onClick={back}>
              ← Back
            </button>
          ) : (
            <span />
          )}
          <div className="ob-footer-right">
            <button type="button" className="ob-later" onClick={() => void advance(true)} title={copy.later}>
              Fill out later
            </button>
            <button type="button" className="ob-continue" onClick={() => void advance(false)} disabled={saving}>
              {saving ? "Saving…" : step === STEPS.length - 1 ? "Finish" : prefilled ? "Looks right" : "Continue"}
              <kbd aria-hidden="true">↵</kbd>
            </button>
          </div>
        </footer>
        <p className="ob-later-note">{copy.later}</p>
      </section>
    </Frame>
  );
}

function Progress({
  step,
  onJump,
  deferred = [],
  complete = false,
}: {
  step: number;
  onJump: (index: number) => void;
  deferred?: StepId[];
  complete?: boolean;
}) {
  return (
    <div className="ob-progress" aria-label={`Step ${Math.min(step + 1, STEPS.length)} of ${STEPS.length}`}>
      {STEPS.map((item, index) => {
        const state = complete || index < step ? "done" : index === step ? "current" : "todo";
        return (
          <button
            key={item.id}
            type="button"
            title={`${item.label}${deferred.includes(item.id) ? " · for later" : ""}`}
            className={`ob-seg-bar ob-seg-${state}`}
            onClick={() => index < step && onJump(index)}
            disabled={index >= step}
            aria-label={item.label}
          />
        );
      })}
    </div>
  );
}
