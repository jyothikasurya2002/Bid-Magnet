"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type LoginFormProps = {
  configured: boolean;
};

export function LoginForm({ configured }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/company`,
        },
      });
      if (signInError) {
        setError(signInError.message);
      } else {
        setSentTo(email.trim());
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sign-in email could not be sent.");
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <div className="notice notice-success" role="status">
        <strong>Check your inbox</strong>
        <span>Open the sign-in link in this same browser. It was sent to {sentTo}.</span>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="form-stack">
      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.es"
          required
          disabled={!configured || pending}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <button className="button button-primary button-full" disabled={!configured || pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
