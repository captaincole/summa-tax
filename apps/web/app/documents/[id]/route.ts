import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readBlob } from "@/lib/blobStore";
import { getDocumentById, hasMembership } from "@/lib/serverDb";

// Same-origin Route Handler for document downloads. Reads the cookie (which
// the browser DOES send on plain <a href> clicks, unlike the bearer header),
// validates the user via the Supabase server client (auth is still Supabase
// until Phase 2), looks up the row in the libsql app DB, verifies the caller
// holds a non-revoked membership on the document's filing (the explicit RLS
// replacement), and streams the file straight off the local documents dir —
// no bucket, no signed URLs.
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
  let bytes: Buffer;
  try {
    bytes = await readBlob(doc.storagePath);
  } catch {
    // Row exists but the file is gone — surface as 404, not 500.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": doc.mimeType ?? "application/octet-stream",
    "Content-Length": String(bytes.byteLength),
    "Cache-Control": "private, no-store",
  });
  // RFC 5987 filename* handles non-ASCII (em-dashes in draft names).
  const encoded = encodeURIComponent(doc.filename);
  headers.set(
    "Content-Disposition",
    `${wantsDownload ? "attachment" : "inline"}; filename*=UTF-8''${encoded}`,
  );
  return new NextResponse(new Uint8Array(bytes), { status: 200, headers });
}
