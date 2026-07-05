import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchOpenActions } from "@/lib/serverDb";

// Open (open|processing) requested-action cards for the dashboard. Auth via
// the Supabase session cookie; rows from the libsql app DB.
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const yearRaw = Number(request.nextUrl.searchParams.get("year") ?? "");
  if (!Number.isInteger(yearRaw)) {
    return NextResponse.json({ error: "year is required" }, { status: 400 });
  }

  const actions = await fetchOpenActions(user.id, yearRaw);
  return NextResponse.json(actions);
}
