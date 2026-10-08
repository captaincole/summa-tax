import { NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/localAuth";
import { getOwnerFilingForYear, listDrafts } from "@/lib/serverDb";

// Engine-generated drafts for the owner's Forms tab — resolves the
// caller's own filing for the demo tax year.

const DEMO_TAX_YEAR = 2025;

export async function GET() {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const filing = await getOwnerFilingForYear(session.userId, DEMO_TAX_YEAR);
  return NextResponse.json(await listDrafts(filing.id));
}
