import { NextResponse } from "next/server";
import { createOwner, ownerExists, login } from "@/lib/localAuth";

// First-run setup: create the instance owner. 409s once an owner exists —
// this is a one-shot endpoint, not a signup system.
export async function POST(request: Request) {
  if (await ownerExists()) {
    return NextResponse.json({ error: "already set up" }, { status: 409 });
  }
  let body: { email?: string; displayName?: string; password?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const email = body.email?.trim();
  const displayName = body.displayName?.trim();
  const password = body.password ?? "";
  if (!email || !displayName) {
    return NextResponse.json({ error: "email and name are required" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }
  await createOwner({ email, displayName, password });
  // Log the fresh owner straight in — no reason to make them retype it.
  await login(password);
  return NextResponse.json({ ok: true });
}
