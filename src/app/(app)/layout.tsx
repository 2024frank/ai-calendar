import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireUser();
  return (
    <div className="shell">
      <aside className="side" style={{ display: "flex", flexDirection: "column" }}>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/communityhub-wordmark.png"
            alt="CommunityHub"
            style={{ width: "100%", maxWidth: 168, height: "auto", display: "block" }}
          />
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
              marginTop: 7,
            }}
          >
            AI Calendar
          </div>
        </div>
        <Nav role={s.role} />
        <div style={{ flex: 1 }} />
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, wordBreak: "break-word" }}>
            {s.name || s.email}
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            {s.role.replace(/_/g, " ")}
          </div>
          <form action="/api/auth/logout" method="post" style={{ marginTop: 10 }}>
            <button className="btn" style={{ width: "100%", justifyContent: "center" }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
