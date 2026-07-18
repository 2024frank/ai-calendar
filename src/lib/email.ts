import "server-only";
import { Resend } from "resend";

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(title: string, body: string) {
  const base = process.env.APP_URL || "https://ai-calendar.uhurued.com";
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <img src="${base}/brand/communityhub-wordmark.png" alt="CommunityHub" width="180" style="display:block;border:0;margin:0 0 20px" />
  <h2 style="margin:0 0 12px;font-size:18px;color:#111">${title}</h2>
  ${body}
  <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">AI Calendar · CommunityHub</p>
</div>`;
}

async function send(to: string, subject: string, html: string): Promise<{ delivered: boolean }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // No provider configured. Never log the body (it carries a login token),
    // and only note the attempt in development.
    if (process.env.NODE_ENV !== "production") {
      console.log(`[email:dev] to=${to} subject="${subject}" (token redacted)`);
    }
    return { delivered: false };
  }
  const resend = new Resend(key);
  await resend.emails.send({
    from: process.env.EMAIL_FROM || "AI Calendar <noreply@uhurued.com>",
    to: [to],
    subject,
    html,
  });
  return { delivered: true };
}

export async function sendMagicLink(email: string, link: string) {
  const html = shell(
    "Sign in to AI Calendar",
    `<p style="color:#333;font-size:14px">Click the button to sign in. This link expires in 15 minutes.</p>
     <p><a href="${link}" style="display:inline-block;background:#2f6d4f;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Sign in</a></p>
     <p style="color:#888;font-size:12px;word-break:break-all">${link}</p>`,
  );
  const res = await send(email, "Your AI Calendar sign-in link", html);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

export async function sendPasswordSetup(email: string, link: string, isReset: boolean) {
  const title = isReset ? "Reset your password" : "Set your password";
  const html = shell(
    title,
    `<p style="color:#333;font-size:14px">Click the button to ${isReset ? "choose a new password" : "set your password"} and sign in. This link expires in 24 hours.</p>
     <p><a href="${link}" style="display:inline-block;background:#2f7d55;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">${title}</a></p>
     <p style="color:#888;font-size:12px;word-break:break-all">${link}</p>`,
  );
  const res = await send(email, `${title} — AI Calendar`, html);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

export async function sendInvite(email: string, link: string, communityName: string) {
  const safeName = esc(communityName);
  const html = shell(
    `You've been added to ${safeName}`,
    `<p style="color:#333;font-size:14px">You now have access to the ${safeName} calendar workspace. Click to sign in.</p>
     <p><a href="${link}" style="display:inline-block;background:#2f6d4f;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px">Open AI Calendar</a></p>
     <p style="color:#888;font-size:12px;word-break:break-all">${link}</p>`,
  );
  const res = await send(email, `You've been added to ${communityName} on AI Calendar`, html);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}
