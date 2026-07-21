import "server-only";
import nodemailer from "nodemailer";
import { Resend } from "resend";

/**
 * The email design, brought over from the ai-microgrant app where it was built.
 * Same palette, brand header, section labels, and button. What changed is the
 * plumbing: this app sends over Hostinger with Resend as a fallback, and its
 * messages are the sign-in link, the password setup, the invite, and the
 * reviewer digest rather than that app's four.
 */

const APP_URL = (process.env.APP_URL || "https://ai-calendar.uhurued.com").replace(/\/$/, "");
// The square mark, not the wordmark: the header slots it at 42px and the
// wordmark is 1662x255, which would render as a smear at that size.
const LOGO_URL = `${APP_URL}/brand/communityhub-mark.png`;

const COLORS = {
  ink: "#212934",
  body: "#4a4e57",
  muted: "#7a7f88",
  border: "#dcdee1",
  surface: "#f6f7f9",
  green: "#34724a",
  greenSoft: "#f1faf3",
  amber: "#8d4d0a",
  amberSoft: "#fff8eb",
  red: "#9d3029",
} as const;

function esc(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function brandHeader(context: string): string {
  return `<tr>
    <td style="padding:22px 30px;border-bottom:1px solid ${COLORS.border};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="52" valign="middle">
            <img src="${LOGO_URL}" width="42" height="42" alt="CommunityHub AI Calendar" style="display:block;width:42px;height:42px;border:0;" />
          </td>
          <td valign="middle">
            <div style="font-size:16px;line-height:20px;font-weight:700;color:${COLORS.ink};">AI Calendar</div>
            <div style="margin-top:2px;font-size:12px;line-height:17px;color:${COLORS.muted};">CommunityHub &middot; ${esc(context)}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

function emailShell(opts: { context: string; preheader: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>AI Calendar &middot; ${esc(opts.context)}</title>
</head>
<body style="margin:0;padding:0;background:${COLORS.surface};font-family:Arial,'Helvetica Neue',sans-serif;color:${COLORS.ink};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(opts.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:${COLORS.surface};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${COLORS.border};border-radius:6px;">
          ${brandHeader(opts.context)}
          <tr><td style="padding:30px;">${opts.body}</td></tr>
          <tr>
            <td style="padding:18px 30px;border-top:1px solid ${COLORS.border};font-size:11px;line-height:17px;color:${COLORS.muted};">
              AI Calendar &middot; CommunityHub<br />Oberlin, Ohio
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function sectionLabel(label: string): string {
  return `<p style="margin:26px 0 9px;font-size:13px;line-height:18px;font-weight:700;color:${COLORS.ink};">${esc(label)}</p>`;
}

function primaryButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0 2px;">
    <tr><td bgcolor="${COLORS.green}" style="border-radius:4px;">
      <a href="${esc(href)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:14px;line-height:18px;font-weight:700;">${esc(label)}</a>
    </td></tr>
  </table>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 18px;font-size:24px;line-height:31px;font-weight:700;color:${COLORS.ink};">${esc(text)}</h1>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0;font-size:14px;line-height:22px;color:${COLORS.body};">${esc(text)}</p>`;
}

// Friendly display name shown as the sender, whichever transport delivers.
const FROM_NAME = "AI Calendar by CommunityHub";

/** Send over Hostinger SMTP with the mailbox added to the server. */
async function sendViaHostinger(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<boolean> {
  const user = process.env.HOSTINGER_EMAIL?.trim();
  const pass = process.env.HOSTINGER_EMAIL_PASSWORD;
  if (!user || !pass) return false;
  const transport = nodemailer.createTransport({
    host: process.env.HOSTINGER_SMTP_HOST || "smtp.hostinger.com",
    port: Number(process.env.HOSTINGER_SMTP_PORT || 465),
    secure: true, // port 465 is implicit TLS
    auth: { user, pass },
  });
  await transport.sendMail({ from: { name: FROM_NAME, address: user }, to, subject, html, text });
  return true;
}

async function send(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<{ delivered: boolean }> {
  // Hostinger SMTP first (the mailbox on the server), then Resend, then dev note.
  try {
    if (await sendViaHostinger(to, subject, html, text)) return { delivered: true };
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
        text,
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
  const html = emailShell({
    context: "Sign in",
    preheader: "Your sign-in link, good for 15 minutes.",
    body: `
      ${heading("Sign in to AI Calendar")}
      ${paragraph("Use the button below to sign in. The link expires in 15 minutes and can only be used once.")}
      ${primaryButton(link, "Sign in")}
    `,
  });
  const text = `Sign in to AI Calendar\n\nUse this link to sign in. It expires in 15 minutes.\n\n${link}\n\nAI Calendar, CommunityHub, Oberlin, Ohio`;
  const res = await send(email, "Your AI Calendar sign-in link", html, text);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

export async function sendPasswordSetup(email: string, link: string, isReset: boolean) {
  const title = isReset ? "Reset your password" : "Set your password";
  const html = emailShell({
    context: isReset ? "Password reset" : "Password setup",
    preheader: `${title}. The link is good for 24 hours.`,
    body: `
      ${heading(title)}
      ${paragraph(
        `Use the button below to ${isReset ? "choose a new password" : "set your password"} for AI Calendar. The link expires in 24 hours.`,
      )}
      ${primaryButton(link, title)}
    `,
  });
  const text = `${title}\n\nUse this link to ${isReset ? "choose a new password" : "set your password"} for AI Calendar. It expires in 24 hours.\n\n${link}\n\nAI Calendar, CommunityHub, Oberlin, Ohio`;
  const res = await send(email, `${title}, AI Calendar`, html, text);
  return { delivered: res.delivered, devLink: res.delivered ? undefined : link };
}

export async function sendInvite(email: string, link: string, communityName: string) {
  const html = emailShell({
    context: "Welcome",
    preheader: `Your access to ${communityName} is ready.`,
    body: `
      ${heading("Welcome to AI Calendar")}
      ${paragraph(`You have been added to ${communityName}. Sign in below to get started.`)}
      ${sectionLabel("What you can do")}
      <ul style="margin:0;padding:0 0 0 20px;color:${COLORS.body};font-size:13px;line-height:21px;">
        <li style="margin:0 0 6px;">Review incoming events and approve or reject them.</li>
        <li style="margin:0 0 6px;">Edit event details before publishing.</li>
        <li style="margin:0;">Get an email when new events arrive for review.</li>
      </ul>
      ${primaryButton(link, "Sign in")}
    `,
  });
  const text = `Welcome to AI Calendar\n\nYou have been added to ${communityName}. Sign in to get started.\n\n${link}\n\nAI Calendar, CommunityHub, Oberlin, Ohio`;
  const res = await send(
    email,
    `You have been added to ${communityName} on AI Calendar`,
    html,
    text,
  );
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
  const plural = n === 1 ? "" : "s";

  const rows = events
    .slice(0, 20)
    .map(
      (e) => `<tr>
        <td style="padding:11px 0;border-bottom:1px solid ${COLORS.border};font-size:14px;line-height:20px;color:${COLORS.ink};">${esc(e.title)}</td>
        <td align="right" style="padding:11px 0 11px 16px;border-bottom:1px solid ${COLORS.border};font-size:12px;line-height:18px;color:${COLORS.muted};white-space:nowrap;">${esc(e.when)}</td>
      </tr>`,
    )
    .join("");
  const more =
    n > 20
      ? `<p style="margin:8px 0 0;font-size:12px;line-height:18px;color:${COLORS.muted};">+ ${n - 20} more</p>`
      : "";

  const html = emailShell({
    context: "Event review",
    preheader: `${n} new event${plural} from ${sourceName} waiting in your queue.`,
    body: `
      ${heading(`${n} new event${plural} to review`)}
      ${paragraph(`${sourceName} brought in ${n} new event${plural} for ${communityName}, waiting in your review queue.`)}
      ${sectionLabel("New events")}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid ${COLORS.border};">
        ${rows}
      </table>
      ${more}
      ${primaryButton(reviewUrl, "Open review queue")}
    `,
  });

  const list = events
    .slice(0, 20)
    .map((e) => `- ${e.title} (${e.when})`)
    .join("\n");
  const text = `${n} new event${plural} to review\n\n${sourceName} brought in ${n} new event${plural} for ${communityName}.\n\n${list}${n > 20 ? `\n+ ${n - 20} more` : ""}\n\nOpen the review queue: ${reviewUrl}\n\nAI Calendar, CommunityHub, Oberlin, Ohio`;

  const res = await send(to, `${n} new event${plural} to review, ${communityName}`, html, text);
  return { delivered: res.delivered };
}
