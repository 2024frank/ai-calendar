import "server-only";
import { Resend } from "resend";

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BRAND = "#2f6d4f";
const INK = "#14201a";
const MUTED = "#6b7a72";

/**
 * A professional, email-client-safe shell. Table layout and inline styles,
 * because Gmail/Outlook strip <style> and modern CSS. A logo header on the brand
 * colour, a white card, an optional call-to-action button, and a footer.
 */
function shell(opts: {
  title: string;
  intro?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  preheader?: string;
}) {
  const base = process.env.APP_URL || "https://ai-calendar.uhurued.com";
  const { title, intro, bodyHtml, ctaLabel, ctaUrl, preheader } = opts;

  const cta =
    ctaLabel && ctaUrl
      ? `<tr><td style="padding:8px 0 4px">
           <a href="${ctaUrl}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-size:15px;font-weight:600">${ctaLabel}</a>
         </td></tr>`
      : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#eef2ef">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader ?? title)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2ef;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%">
        <tr><td style="background:${BRAND};border-radius:16px 16px 0 0;padding:22px 28px" align="left">
          <img src="${base}/brand/communityhub-wordmark.png" alt="CommunityHub" width="170" style="display:block;border:0;filter:brightness(0) invert(1)" />
        </td></tr>
        <tr><td style="background:#ffffff;padding:28px 28px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
          <h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;color:${INK};font-weight:700">${esc(title)}</h1>
          ${intro ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#33413a">${intro}</p>` : ""}
          ${bodyHtml ?? ""}
          <table role="presentation" cellpadding="0" cellspacing="0">${cta}</table>
        </td></tr>
        <tr><td style="background:#ffffff;border-radius:0 0 16px 16px;border-top:1px solid #eef2ef;padding:16px 28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
          <p style="margin:0;color:${MUTED};font-size:12px;line-height:1.5">AI Calendar for CommunityHub. You are receiving this because you review events for a community here.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
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
  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || "AI Calendar <noreply@uhurued.com>",
      to: [to],
      subject,
      html,
    });
    if (error) {
      // Bad key, unverified domain, etc. Fall back to the copyable link so the
      // admin flow never hard-fails. Never log the html (it carries a token).
      console.error(`[email] send failed to=${to}: ${error.name} ${error.message}`);
      return { delivered: false };
    }
    return { delivered: true };
  } catch (e) {
    console.error(`[email] send threw to=${to}: ${(e as Error).message}`);
    return { delivered: false };
  }
}

function linkLine(link: string) {
  return `<p style="margin:14px 0 0;color:${MUTED};font-size:12px;line-height:1.5;word-break:break-all">Or paste this link: ${link}</p>`;
}

export async function sendMagicLink(email: string, link: string) {
  const html = shell({
    title: "Sign in to AI Calendar",
    intro: "Use the button below to sign in. For your security, this link expires in 15 minutes.",
    ctaLabel: "Sign in",
    ctaUrl: link,
    bodyHtml: linkLine(link),
    preheader: "Your sign-in link (expires in 15 minutes)",
  });
  const res = await send(email, "Your AI Calendar sign-in link", html);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

export async function sendPasswordSetup(email: string, link: string, isReset: boolean) {
  const title = isReset ? "Reset your password" : "Set your password";
  const html = shell({
    title,
    intro: `Use the button below to ${isReset ? "choose a new password" : "set your password"} and sign in. This link expires in 24 hours.`,
    ctaLabel: title,
    ctaUrl: link,
    bodyHtml: linkLine(link),
    preheader: `${title} for AI Calendar`,
  });
  const res = await send(email, `${title} — AI Calendar`, html);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

export async function sendInvite(email: string, link: string, communityName: string) {
  const safeName = esc(communityName);
  const html = shell({
    title: `You've been added to ${safeName}`,
    intro: `You now have access to the ${safeName} calendar workspace. Use the button below to sign in.`,
    ctaLabel: "Open AI Calendar",
    ctaUrl: link,
    bodyHtml: linkLine(link),
    preheader: `You've been added to ${safeName}`,
  });
  const res = await send(email, `You've been added to ${communityName} on AI Calendar`, html);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

/**
 * A digest emailed to reviewers when a run brings in new pending events.
 * Lists each new event with its date, and links to the review queue.
 */
export async function sendNewEventsDigest(
  to: string,
  opts: {
    communityName: string;
    sourceName: string;
    events: { title: string; when: string }[];
    reviewUrl: string;
  },
) {
  const { communityName, sourceName, events, reviewUrl } = opts;
  const n = events.length;
  const rows = events
    .slice(0, 20)
    .map(
      (e) => `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #eef2ef;font-size:14px;color:${INK};font-weight:600">${esc(e.title)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #eef2ef;font-size:13px;color:${MUTED};text-align:right;white-space:nowrap">${esc(e.when)}</td>
      </tr>`,
    )
    .join("");
  const more = n > 20 ? `<p style="margin:12px 0 0;color:${MUTED};font-size:13px">and ${n - 20} more.</p>` : "";

  const html = shell({
    title: `${n} new event${n === 1 ? "" : "s"} to review`,
    intro: `${esc(sourceName)} just brought in ${n} new event${n === 1 ? "" : "s"} for ${esc(communityName)}. They are waiting in your review queue.`,
    bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px">${rows}</table>${more}`,
    ctaLabel: "Review events",
    ctaUrl: reviewUrl,
    preheader: `${n} new event${n === 1 ? "" : "s"} from ${sourceName}`,
  });
  const res = await send(to, `${n} new event${n === 1 ? "" : "s"} to review — ${communityName}`, html);
  return { delivered: res.delivered };
}
