import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStorageAdminClient } from "@/lib/supabaseAdmin";
import { getDocumentById, hasMembership } from "@/lib/serverDb";

// Same-origin Route Handler that replaces the agent's /documents/{id} for
// browser-initiated navigations. Reads the cookie (which the browser DOES
// send on plain <a href> clicks, unlike the bearer header), validates the
// user via Supabase server client, looks up the row in the libsql app DB,
// verifies the caller holds a non-revoked membership on the document's
// filing (the explicit RLS replacement), mints a 60-second signed Storage
// URL, and 302s to it.
//
// `?download=1` flips Content-Disposition to attachment so the Documents
// page's Download button forces a save instead of inline rendering.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const doc = await getDocumentById(id);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Membership gate — 404 (not 403) so non-members can't probe which
  // document ids exist, matching the old RLS behavior.
  if (!(await hasMembership(doc.filingId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const wantsDownload = request.nextUrl.searchParams.get("download") === "1";
  // Service-role for the signed URL — the bucket's RLS references the
  // now-empty Postgres filing_members; membership was verified above.
  const { data: signed, error: signError } = await getStorageAdminClient().storage
    .from("user-documents")
    .createSignedUrl(
      doc.storagePath,
      60,
      wantsDownload ? { download: doc.filename } : undefined,
    );
  if (signError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `sign failed: ${signError?.message ?? "no url"}` },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl, 302);
}
