import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Temporary diagnostic: reports whether Hostinger SMTP actually connects and
 * sends from this environment. Guarded by the agent ingest secret. Delete after.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== process.env.AGENT_INGEST_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const to = url.searchParams.get("to") || "fkusiapp@oberlin.edu";
  const user = process.env.HOSTINGER_EMAIL?.trim();
  const pass = process.env.HOSTINGER_EMAIL_PASSWORD;
  const port = Number(url.searchParams.get("port") || process.env.HOSTINGER_SMTP_PORT || 465);

  if (!user || !pass) {
    return NextResponse.json({ hostingerConfigured: false, hasUser: !!user, hasPass: !!pass });
  }

  const transport = nodemailer.createTransport({
    host: process.env.HOSTINGER_SMTP_HOST || "smtp.hostinger.com",
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });

  try {
    await transport.verify();
    const info = await transport.sendMail({
      from: user,
      to,
      subject: "Hostinger SMTP diagnostic",
      text: "If you received this, Hostinger SMTP is working from the server.",
    });
    return NextResponse.json({ ok: true, transport: "hostinger", from: user, port, messageId: info.messageId });
  } catch (e) {
    return NextResponse.json({ ok: false, port, error: (e as Error).message });
  }
}
