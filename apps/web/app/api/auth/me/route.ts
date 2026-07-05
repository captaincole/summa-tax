import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/localAuth";

// Session probe for client components (AppShell's pre-stream guard).
export async function GET() {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    userId: session.userId,
    email: session.email,
    displayName: session.displayName,
  });
}
