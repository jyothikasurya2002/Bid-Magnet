import Link from "next/link";
import { redirect } from "next/navigation";
import { isSupabaseConfigured, createClient } from "@/lib/supabase/server";
import { requestMagicLink } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{ error?: string; sent?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();

  if (configured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/onboarding");
  }

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark">BM</span>
        <span>Tender Copilot</span>
      </div>

      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">Your virtual bid team</p>
        <h1 id="login-title">Sign in to BidMagnet</h1>
        <p className="lede">
          We&apos;ll email you a secure sign-in link. No password required.
        </p>

        {!configured ? (
          <div className="notice notice-warning" role="alert">
            <strong>Supabase needs configuring</strong>
            <span>
              Add the project URL and anon key to <code>web/.env.local</code>.
            </span>
          </div>
        ) : null}

        {params.error ? (
          <div className="notice notice-error" role="alert">
            {params.error}
          </div>
        ) : null}

        {params.sent ? (
          <div className="notice notice-success" role="status">
            <strong>Check your inbox</strong>
            <span>We sent a sign-in link to {params.sent}.</span>
          </div>
        ) : (
          <form action={requestMagicLink} className="form-stack">
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.es"
                required
                disabled={!configured}
              />
            </div>
            <button className="button button-primary button-full" disabled={!configured}>
              Email me a sign-in link
            </button>
          </form>
        )}

        <p className="auth-footnote">
          Tender Copilot prepares your bid. You still submit on the official
          procurement platform.
        </p>
        {params.sent ? <Link href="/login">Use another email</Link> : null}
      </section>
    </main>
  );
}
