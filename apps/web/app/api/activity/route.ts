import { type NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/localAuth";
import { fetchActivityItems } from "@/lib/serverDb";
import { ACTIVITY_TAX_YEAR } from "@/lib/activity";

// Activity feed for the polling ActivityCard. Auth via the owner session
// cookie; rows from the libsql app DB, scoped explicitly to the caller.
export async function GET(request: NextRequest) {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(limitRaw, 200) : 50;

  const items = await fetchActivityItems(session.userId, ACTIVITY_TAX_YEAR, limit);
  return NextResponse.json(items);
}
