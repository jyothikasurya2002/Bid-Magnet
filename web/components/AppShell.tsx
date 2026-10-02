import Link from "next/link";
import { signOut } from "@/app/login/actions";

type AppShellProps = {
  active: "discover" | "pipeline" | "bid-prep" | "outcomes" | "vault";
  companyName?: string;
  userEmail?: string;
  children: React.ReactNode;
};

const NAV_ITEMS = [
  { key: "discover", label: "Discover", href: "/discover" },
  { key: "pipeline", label: "Pipeline", href: "#" },
  { key: "bid-prep", label: "Bid prep", href: "#" },
  { key: "outcomes", label: "Outcomes", href: "#" },
  { key: "vault", label: "Vault", href: "/onboarding" },
] as const;

export function AppShell({
  active,
  companyName = "Company profile",
  userEmail,
  children,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/discover" className="product-name" aria-label="Tender Copilot home">
          <span className="brand-mark brand-mark-small">BM</span>
          <span>Tender Copilot</span>
        </Link>

        <nav className="main-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={active === item.key ? "nav-link nav-link-active" : "nav-link"}
              aria-current={active === item.key ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="account-menu">
          <span className="account-copy">
            <strong>{companyName}</strong>
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
