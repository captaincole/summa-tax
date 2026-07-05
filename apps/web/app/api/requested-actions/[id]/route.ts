import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { markActionProcessing, skipAction } from "@/lib/serverDb";

// Status transitions the browser is allowed to drive:
//   processing — an upload for this card just landed (documentId required)
//   skipped    — the user dismissed the card
// Both UPDATEs scope by (id, user_id) in serverDb — a caller can only touch
// their own cards.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { status?: string; documentId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (body.status === "processing") {
    if (!body.documentId) {
      return NextResponse.json(
        { error: "documentId required for status=processing" },
        { status: 400 },
      );
    }
    await markActionProcessing(user.id, id, body.documentId);
  } else if (body.status === "skipped") {
    await skipAction(user.id, id);
  } else {
    return NextResponse.json(
      { error: `unsupported status '${body.status}'` },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
