import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { activeModel, setActiveModel } from "@/lib/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  if (s?.role !== "platform_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json({ model: await activeModel() });
}

export async function PUT(req: Request) {
  const s = await getSession();
  if (s?.role !== "platform_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { model?: string };
  try {
    await setActiveModel(String(body.model ?? ""));
  } catch {
    return NextResponse.json({ error: "Unknown model" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, model: body.model });
}
