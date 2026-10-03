"use client";

import { useState } from "react";
import { companyFromRow, companyWritePayload } from "@/lib/profile";
import { createClient } from "@/lib/supabase/client";
import { EMPTY_COMPANY, type CompanyProfile } from "@/lib/types";

type CompanyStartProps = {
  onCreated: (company: CompanyProfile, importWebsite: boolean) => void;
};

// First visit only: create the row, then everything else is edited in place.
export function CompanyStart({ onCreated }: CompanyStartProps) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter your company's legal name.");
      return;
    }
    setPending(true);
    setError("");
    const url = website.trim() && !/^https?:\/\//i.test(website.trim()) ? `https://${website.trim()}` : website;
    const { data, error: insertError } = await createClient()
      .from("companies")
      .insert(
        companyWritePayload(
          { ...EMPTY_COMPANY, name, website_url: url },
          new Date().toISOString(),
        ),
      )
      .select("*")
      .single();
    setPending(false);
    if (insertError || !data) {
      setError(insertError?.message || "The profile couldn't be created. Try again.");
      return;
    }
    onCreated(companyFromRow(data), Boolean(url.trim()));
  }

  return (
    <main className="start-page">
      <form className="start-card" onSubmit={create}>
        <h1>Set up your company</h1>
        <p>
          Start with your name and website. We read your site and suggest the rest; you
          confirm each fact and keep adding to it as things change.
        </p>
        {error ? (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="start-name">Legal company name</label>
          <input
            id="start-name"
            autoComplete="organization"
            placeholder="Bitácora Software, S.L."
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="start-website">
            Website <span className="optional">(optional)</span>
          </label>
          <input
            id="start-website"
            inputMode="url"
            placeholder="yourcompany.es"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
          />
        </div>
        <button className="button button-dark button-full" disabled={pending}>
          {pending ? "Creating…" : website.trim() ? "Create and read my website" : "Create profile"}
        </button>
      </form>
    </main>
  );
}
