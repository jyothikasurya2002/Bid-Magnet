import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/login/actions";
import { Welcome } from "@/components/welcome/Welcome";
import { companyFromRow } from "@/lib/profile";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const metadata = {
  title: "Welcome",
};

export default async function WelcomePage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("companies")
    .select("*")
    .eq("owner", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (
    <div className="welcome-page">
      <header className="welcome-top">
        <Link href="/company" className="product-name" aria-label="BidMagnet">
          <span className="brand-mark" aria-hidden="true" />
          <span>BidMagnet</span>
        </Link>
        <form action={signOut}>
          <button className="text-button" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <main className="welcome-main">
        <Welcome initialCompany={data ? companyFromRow(data) : null} />
      </main>
    </div>
  );
}
