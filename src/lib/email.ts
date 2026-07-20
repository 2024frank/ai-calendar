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

/**
 * As plain as an email gets: no logo, no heading, no button, no colours. Just a
 * couple of sentences and a text link, like a person typed it.
 */
function shell(opts: { title?: string; intro?: string; bodyHtml?: string; ctaLabel?: string; ctaUrl?: string }) {
  const { intro, bodyHtml, ctaLabel, ctaUrl } = opts;
  const link = ctaLabel && ctaUrl ? `<p style="margin:12px 0 0"><a href="${ctaUrl}">${esc(ctaLabel)}</a></p>` : "";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#111">
${intro ? `<p style="margin:0">${intro}</p>` : ""}
${bodyHtml ?? ""}
${link}
</div>`;
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
        from: process.env.EMAIL_FROM || `${FROM_NAME} <noreply@uhurued.com>`,
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
    intro: "Here is your sign-in link for AI Calendar. It expires in 15 minutes.",
    ctaLabel: "Sign in",
    ctaUrl: link,
  });
  const res = await send(email, "Your AI Calendar sign-in link", html);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

export async function sendPasswordSetup(email: string, link: string, isReset: boolean) {
  const title = isReset ? "Reset your password" : "Set your password";
  const html = shell({
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
    intro: `You've been added to the ${safeName} calendar on AI Calendar. Use this link to sign in.`,
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
        <td style="padding:6px 0;font-size:14px;color:#222">${esc(e.title)}</td>
        <td style="padding:6px 0;font-size:13px;color:#888;text-align:right;white-space:nowrap">${esc(e.when)}</td>
      </tr>`,
    )
    .join("");
  const more = n > 20 ? `<p style="margin:8px 0 0;color:#888;font-size:13px">and ${n - 20} more.</p>` : "";

  const html = shell({
    title: `${n} new event${n === 1 ? "" : "s"} to review`,
    intro: `${esc(sourceName)} just brought in ${n} new event${n === 1 ? "" : "s"} for ${esc(communityName)}. They are waiting in your review queue.`,
    bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px">${rows}</table>${more}`,
    ctaLabel: "Review events",
    ctaUrl: reviewUrl
  });
  const res = await send(to, `${n} new event${n === 1 ? "" : "s"} to review — ${communityName}`, html);
  return { delivered: res.delivered };
}
