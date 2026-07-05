import { NextResponse } from "next/server";
import { login } from "@/lib/localAuth";

export async function POST(request: Request) {
  let body: { password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const session = await login(body.password ?? "");
  if (!session) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, userId: session.userId });
}
