import Link from "next/link";
import { signOut } from "@/app/login/actions";

type AppShellProps = {
  active: "discover" | "pipeline" | "company";
  companyName?: string;
  userEmail?: string;
  children: React.ReactNode;
};

// Discover, Pipeline and Company exist so far; the rest show as upcoming.
const NAV_ITEMS = [
  { key: "discover", label: "Discover", href: "/discover" },
  { key: "pipeline", label: "Pipeline", href: "/pipeline" },
  { key: "bid-prep", label: "Bid prep" },
  { key: "outcomes", label: "Outcomes" },
  { key: "company", label: "Company", href: "/company" },
] as const;

export function AppShell({ active, companyName, userEmail, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/discover" className="product-name" aria-label="BidMagnet home">
          <span className="brand-mark" aria-hidden="true" />
          <span>BidMagnet</span>
        </Link>

        <nav className="main-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) =>
            "href" in item ? (
              <Link
                key={item.key}
                href={item.href}
                className={active === item.key ? "nav-link nav-link-active" : "nav-link"}
                aria-current={active === item.key ? "page" : undefined}
              >
                {item.label}
              </Link>
            ) : (
              <span key={item.key} className="nav-link nav-link-soon" title="Not built yet">
                {item.label}
              </span>
            ),
          )}
        </nav>

        <div className="account-menu">
          <span className="account-copy">
            {companyName ? <strong>{companyName}</strong> : null}
            {userEmail ? <small>{userEmail}</small> : null}
          </span>
          <form action={signOut}>
            <button className="text-button" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      {children}
    </div>
  );
}
