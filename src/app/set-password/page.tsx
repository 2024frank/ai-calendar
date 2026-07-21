import Image from "next/image";
import { SetPasswordForm } from "./SetPasswordForm";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="auth-shell">
      <div className="auth-panel">
        <div className="auth-brand">
          <Image src="/brand/communityhub-wordmark.png" alt="CommunityHub" width={1662} height={255} priority />
          <div className="auth-brand__product">AI Calendar</div>
        </div>
        <SetPasswordForm token={token ?? ""} />
      </div>
    </main>
  );
}
