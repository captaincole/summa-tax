import { type NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/localAuth";
import { fetchOpenActions } from "@/lib/serverDb";

// Open (open|processing) requested-action cards for the dashboard. Auth via
// the owner session cookie; rows from the libsql app DB.
export async function GET(request: NextRequest) {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const yearRaw = Number(request.nextUrl.searchParams.get("year") ?? "");
  if (!Number.isInteger(yearRaw)) {
    return NextResponse.json({ error: "year is required" }, { status: 400 });
  }

  const actions = await fetchOpenActions(session.userId, yearRaw);
  return NextResponse.json(actions);
}
