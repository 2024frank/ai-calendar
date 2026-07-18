import { SetPasswordForm } from "./SetPasswordForm";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "var(--bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/communityhub-wordmark.png"
            alt="CommunityHub"
            style={{ width: 210, height: "auto", display: "block", margin: "0 auto" }}
          />
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "var(--muted)",
              fontWeight: 700,
              marginTop: 8,
            }}
          >
            AI Calendar
          </div>
        </div>
        <SetPasswordForm token={token ?? ""} />
      </div>
    </div>
  );
}
