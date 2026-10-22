import Image from "next/image";
import { SetPasswordForm } from "./SetPasswordForm";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="auth-shell">
      <div className="auth-topbar">
        <Image src="/brand/communityhub-wordmark.png" alt="CommunityHub" width={1662} height={255} priority />
        <span className="auth-topbar__product">AI Calendar</span>
      </div>
      <div className="auth-panel">
        <SetPasswordForm token={token ?? ""} />
      </div>
    </main>
  );
}
