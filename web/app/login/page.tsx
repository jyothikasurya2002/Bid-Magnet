import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { isSupabaseConfigured, createClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const configured = isSupabaseConfigured();

  if (configured) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/discover");
  }

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark" aria-hidden="true" />
        <span>BidMagnet</span>
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

        <LoginForm configured={configured} />

        <p className="auth-footnote">
          BidMagnet prepares your bid. You still submit on the official
          procurement platform.
        </p>
      </section>
    </main>
  );
}
