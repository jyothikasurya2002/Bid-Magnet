"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { STEPS, writeProgress, type OnboardingProgress, type StepId } from "@/lib/onboarding";

const SECTION: Record<StepId, string> = {
  what: "what-you-do",
  where: "where-you-bid",
  finances: "finances",
  registrations: "registrations",
  certifications: "certifications",
  documents: "documents",
};

const noop = () => () => {};

// Onboarding steps left for later (or setup left half-way), shown above the company profile.
export function SetupLaterBar({ companyId }: { companyId: string }) {
  const raw = useSyncExternalStore(
    noop,
    () => {
      try {
        return localStorage.getItem(`bidmagnet:onboarding:${companyId}`);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const [dismissed, setDismissed] = useState(false);

  let progress: OnboardingProgress | null = null;
  try {
    progress = raw ? (JSON.parse(raw) as OnboardingProgress) : null;
  } catch {
    progress = null;
  }
  if (!progress || dismissed) return null;

  if (!progress.completed) {
    return (
      <div className="later-bar">
        <span>You&apos;re part-way through setup.</span>
        <Link className="button button-dark button-small" href="/welcome">
          Continue setup
        </Link>
      </div>
    );
  }

  const later = STEPS.filter((step) => progress.deferred.includes(step.id));
  if (!later.length) return null;

  return (
    <div className="later-bar">
      <span>Left for later</span>
      <div className="later-bar-items">
        {later.map((step) => (
          <a key={step.id} className="later-chip" href={`#${SECTION[step.id]}`}>
            {step.label}
          </a>
        ))}
      </div>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          writeProgress(companyId, { ...progress, deferred: [] });
          setDismissed(true);
        }}
      >
        Done
      </button>
    </div>
  );
}
