"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { companyFromRow, companyPatchPayload, companyWritePayload } from "@/lib/profile";
import { planResearchFill, researchSummaryKey, type ResearchSummary } from "@/lib/research-fill";
import { createClient } from "@/lib/supabase/client";
import { EMPTY_COMPANY, type CompanyProfile } from "@/lib/types";
import {
  elapsedLabel,
  savedResearchJob,
  useNow,
  useResearchJob,
} from "@/components/company/useResearchJob";

type WelcomeProps = {
  // set when the user already has a company (e.g. reloaded mid-research)
  initialCompany: CompanyProfile | null;
};

function withProtocol(website: string) {
  const trimmed = website.trim();
  return trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
}

function hostOf(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

// First run: name + website, then research that fills the profile, then the company page.
export function Welcome({ initialCompany }: WelcomeProps) {
  const [company, setCompany] = useState<CompanyProfile | null>(null);

  if (company) return <ResearchStep company={company} />;
  if (initialCompany) return <ResumeGate company={initialCompany} />;
  return <StartForm onCreated={setCompany} />;
}

function StartForm({ onCreated }: { onCreated: (company: CompanyProfile) => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
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
    const url = withProtocol(website);
    const { data, error: insertError } = await createClient()
      .from("companies")
      .insert(companyWritePayload({ ...EMPTY_COMPANY, name, website_url: url }, new Date().toISOString()))
      .select("*")
      .single();
    if (insertError || !data) {
      setPending(false);
      setError(insertError?.message || "We couldn't create your profile. Try again.");
      return;
    }
    if (!url) {
      router.replace("/company");
      return;
    }
    onCreated(companyFromRow(data));
  }

  return (
    <section className="welcome-card welcome-enter">
      <p className="welcome-eyebrow">Welcome to BidMagnet</p>
      <h1>Let&apos;s find the tenders you can win.</h1>
      <p className="welcome-lede">
        Tell us who you are. We&apos;ll research the rest from your website and public
        records, and fill in your profile.
      </p>

      <form className="welcome-form" onSubmit={submit}>
        <label className="welcome-field">
          <span>Company name</span>
          <input
            autoFocus
            autoComplete="organization"
            placeholder="Bitácora Software"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="welcome-field">
          <span>Website</span>
          <input
            inputMode="url"
            autoComplete="url"
            placeholder="bitacora.es"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </label>
        {error ? (
          <p className="welcome-error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="welcome-button" disabled={pending}>
          {pending ? "Setting up…" : website.trim() ? "Research my company" : "Continue"}
          <span aria-hidden="true">→</span>
        </button>
      </form>

      <p className="welcome-fineprint">
        {website.trim()
          ? "Takes 1–4 minutes. Nothing is final: you check every fact afterwards."
          : "No website? Continue and fill in your profile yourself."}
      </p>
    </section>
  );
}

const noop = () => () => {};

// After a reload: resume the research if one is running, otherwise there's nothing to do here.
function ResumeGate({ company }: { company: CompanyProfile }) {
  const router = useRouter();
  const running = useSyncExternalStore(
    noop,
    () => (company.id ? savedResearchJob(company.id)?.url ?? null : null),
    () => null,
  );

  useEffect(() => {
    if (!company.id || !savedResearchJob(company.id)) router.replace("/company");
  }, [company.id, router]);

  return running ? <ResearchStep company={{ ...company, website_url: running }} /> : null;
}

// What the research looks at, in the order the agent is told to look.
const LOOKING_AT = [
  "Reading your website",
  "Checking your legal notice for the company name and NIF",
  "Searching BORME, the official company register",
  "Looking for ISO and ENS certificates",
  "Working out which tender sectors fit your services",
  "Checking every quote against the page it came from",
];

function ResearchStep({ company }: { company: CompanyProfile }) {
  const router = useRouter();
  const job = useResearchJob(company.id!, company.website_url);
  const { state } = job;
  const now = useNow(state.kind === "running");
  const [saveError, setSaveError] = useState("");
  const filling = useRef(false);

  useEffect(() => {
    if (state.kind !== "done" || filling.current) return;
    filling.current = true;
    const fill = planResearchFill(company, state.result);
    const summary: ResearchSummary = {
      applied: fill.applied,
      review: fill.review,
      sources: state.result.sources.length,
      notFound: state.result.not_found,
    };
    void (async () => {
      if (Object.keys(fill.patch).length) {
        const { error } = await createClient()
          .from("companies")
          .update(companyPatchPayload(fill.patch, new Date().toISOString()))
          .eq("id", company.id);
        if (error) {
          filling.current = false;
          setSaveError(error.message);
          return;
        }
      }
      try {
        sessionStorage.setItem(researchSummaryKey(company.id!), JSON.stringify(summary));
      } catch {
        // Without storage the profile is still filled; only the summary is lost.
      }
      router.replace("/company");
    })();
  }, [state, company, router]);

  const host = hostOf(company.website_url);
  const elapsed = state.kind === "running" ? now - state.startedAt : 0;
  const step = Math.floor(elapsed / 9_000) % LOOKING_AT.length;

  function skip() {
    job.cancel();
    router.replace("/company");
  }

  if (state.kind === "error" || saveError) {
    return (
      <section className="welcome-card welcome-enter">
        <p className="welcome-eyebrow">Research stopped</p>
        <h1>We couldn&apos;t finish researching {host}.</h1>
        <p className="welcome-lede welcome-error-text">
          {saveError || (state.kind === "error" ? state.message : "")}
        </p>
        <div className="welcome-actions">
          <button
            type="button"
            className="welcome-button"
            onClick={() => {
              setSaveError("");
              job.retry();
            }}
          >
            Try again <span aria-hidden="true">→</span>
          </button>
          <button type="button" className="welcome-link" onClick={() => router.replace("/company")}>
            Fill in my profile myself
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="welcome-card welcome-research welcome-enter" aria-live="polite">
      <div className="research-orb" aria-hidden="true">
        <span className="research-ring" />
        <span className="research-ring research-ring-2" />
        <span className="research-ring research-ring-3" />
        <span className="research-core">{host.charAt(0).toUpperCase()}</span>
      </div>

      {state.kind === "done" ? (
        <>
          <h1>Filling in your profile…</h1>
          <p className="welcome-lede">Found {state.result.suggestions.length} facts with sources.</p>
        </>
      ) : (
        <>
          <p className="welcome-eyebrow">{elapsedLabel(elapsed)} · usually 1–4 minutes</p>
          <h1>Researching {host}</h1>
          <p className="research-step" key={step}>
            {LOOKING_AT[step]}…
          </p>
          <div className="research-bar" aria-hidden="true">
            <span />
          </div>
          <p className="welcome-fineprint">
            You can leave this tab open and come back. Every fact will show the page it came
            from.
          </p>
          <button type="button" className="welcome-link" onClick={skip}>
            Skip and fill it in myself
          </button>
        </>
      )}
    </section>
  );
}
