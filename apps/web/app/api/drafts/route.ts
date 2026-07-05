import { type NextRequest, NextResponse } from "next/server";
import { getOwnerSession } from "@/lib/localAuth";
import {
  getOwnerFilingForYear,
  hasMembership,
  listDrafts,
} from "@/lib/serverDb";

// Engine-generated drafts for the Forms tabs. Two callers:
//   - owner Forms tab: no query param — resolves the caller's own filing
//   - CPA Forms tab: ?filingId=<uuid> — allowed only with a non-revoked
//     membership on that filing (the explicit RLS replacement)

const DEMO_TAX_YEAR = 2025;

export async function GET(request: NextRequest) {
  const session = await getOwnerSession();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const filingIdParam = request.nextUrl.searchParams.get("filingId");
  let filingId: string;
  if (filingIdParam) {
    if (!(await hasMembership(filingIdParam, session.userId))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    filingId = filingIdParam;
  } else {
    const filing = await getOwnerFilingForYear(session.userId, DEMO_TAX_YEAR);
    filingId = filing.id;
  }

  return NextResponse.json(await listDrafts(filingId));
}
