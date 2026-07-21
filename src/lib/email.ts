import "server-only";
import nodemailer from "nodemailer";
import { Resend } from "resend";

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(opts: { title?: string; intro?: string; bodyHtml?: string; ctaLabel?: string; ctaUrl?: string }) {
  const { intro, bodyHtml, ctaLabel, ctaUrl } = opts;
  const title = opts.title ?? "AI Calendar";
  const button =
    ctaLabel && ctaUrl
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 0">
          <tr><td style="background:#34724a;border-radius:8px">
            <a href="${esc(ctaUrl)}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-size:14px;font-weight:700;line-height:1;text-decoration:none">${esc(ctaLabel)}</a>
          </td></tr>
        </table>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)}</title>
</head>
<body style="margin:0;background:#f5f7f4;color:#17231b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7f4">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="padding:0 2px 14px">
          <span style="color:#34724a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:800;letter-spacing:-0.02em">CommunityHub</span>
          <span style="color:#667268;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase">&nbsp;&nbsp;AI Calendar</span>
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid #dfe6e1;border-top:3px solid #34724a;border-radius:12px;padding:30px">
          <h1 style="margin:0 0 12px;color:#17231b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:22px;font-weight:750;letter-spacing:-0.02em;line-height:1.25">${esc(title)}</h1>
          <div style="color:#34443a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6">
            ${intro ? `<p style="margin:0 0 18px">${intro}</p>` : ""}
            ${bodyHtml ?? ""}
            ${button}
          </div>
        </td></tr>
        <tr><td style="padding:14px 2px 0;color:#7a867d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5">
          Sent by AI Calendar from CommunityHub.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Friendly display name shown as the sender, whichever transport delivers.
const FROM_NAME = "AI Calendar";

/** Send over Hostinger SMTP with the mailbox added to the server. */
async function sendViaHostinger(to: string, subject: string, html: string): Promise<boolean> {
  const user = process.env.HOSTINGER_EMAIL?.trim();
  const pass = process.env.HOSTINGER_EMAIL_PASSWORD;
  if (!user || !pass) return false;
  const transport = nodemailer.createTransport({
    host: process.env.HOSTINGER_SMTP_HOST || "smtp.hostinger.com",
    port: Number(process.env.HOSTINGER_SMTP_PORT || 465),
    secure: true, // port 465 is implicit TLS
    auth: { user, pass },
  });
  // Show "AI Calendar" as the sender, from the authenticated mailbox.
  await transport.sendMail({ from: { name: FROM_NAME, address: user }, to, subject, html });
  return true;
}

async function send(to: string, subject: string, html: string): Promise<{ delivered: boolean }> {
  // Hostinger SMTP first (the mailbox on the server), then Resend, then dev note.
  try {
    if (await sendViaHostinger(to, subject, html)) return { delivered: true };
  } catch (e) {
    console.error(`[email] hostinger send failed to=${to}: ${(e as Error).message}`);
  }

  const key = process.env.RESEND_API_KEY;
  if (key) {
    try {
      const resend = new Resend(key);
      const { error } = await resend.emails.send({
        from: process.env.EMAIL_FROM || `${FROM_NAME} <ai-calendar@uhurued.com>`,
        to: [to],
        subject,
        html,
      });
      if (!error) return { delivered: true };
      console.error(`[email] resend failed to=${to}: ${error.name} ${error.message}`);
    } catch (e) {
      console.error(`[email] resend threw to=${to}: ${(e as Error).message}`);
    }
  }

  // No provider delivered. Never log the body (it carries a login token).
  if (process.env.NODE_ENV !== "production") {
    console.log(`[email:dev] to=${to} subject="${subject}" (not sent, token redacted)`);
  }
  return { delivered: false };
}

export async function sendMagicLink(email: string, link: string) {
  const html = shell({
    title: "Sign in to AI Calendar",
    intro: "Your sign-in link for AI Calendar. It expires in 15 minutes.",
    ctaLabel: "Sign in",
    ctaUrl: link,
  });
  const res = await send(email, "Your AI Calendar sign-in link", html);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

export async function sendPasswordSetup(email: string, link: string, isReset: boolean) {
  const title = isReset ? "Reset your password" : "Set your password";
  const html = shell({
    title,
    intro: `Use this link to ${isReset ? "choose a new password" : "set your password"} for AI Calendar. It expires in 24 hours.`,
    ctaLabel: title,
    ctaUrl: link,
  });
  const res = await send(email, `${title} — AI Calendar`, html);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

export async function sendInvite(email: string, link: string, communityName: string) {
  const safeName = esc(communityName);
  const html = shell({
    title: "Welcome to AI Calendar",
    intro: `You've been added to ${safeName} on AI Calendar. Sign in below to get started.`,
    ctaLabel: "Sign in",
    ctaUrl: link,
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
        <td style="padding:8px 0;border-bottom:1px solid #edf1ee;font-size:14px;color:#17231b">${esc(e.title)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #edf1ee;font-size:13px;color:#667268;text-align:right;white-space:nowrap">${esc(e.when)}</td>
      </tr>`,
    )
    .join("");
  const more = n > 20 ? `<p style="margin:10px 0 0;color:#667268;font-size:13px">and ${n - 20} more.</p>` : "";

  const html = shell({
    title: `${n} new event${n === 1 ? "" : "s"} to review`,
    intro: `${esc(sourceName)} brought in ${n} new event${n === 1 ? "" : "s"} for ${esc(communityName)}, waiting in your review queue.`,
    bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 0">${rows}</table>${more}`,
    ctaLabel: "Review events",
    ctaUrl: reviewUrl
  });
  const res = await send(to, `${n} new event${n === 1 ? "" : "s"} to review — ${communityName}`, html);
  return { delivered: res.delivered };
}
