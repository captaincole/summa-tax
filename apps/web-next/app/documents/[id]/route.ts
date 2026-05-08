import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Same-origin Route Handler that replaces the agent's /documents/{id} for
// browser-initiated navigations. Reads the cookie (which the browser DOES
// send on plain <a href> clicks, unlike the bearer header), validates the
// user via Supabase server client, looks up the row (RLS scopes to the
// current user), mints a 60-second signed Storage URL, and 302s to it.
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

  const { data: doc, error: docError } = await supabase
    .from("user_documents")
    .select("storage_path, filename")
    .eq("id", id)
    .maybeSingle();
  if (docError) {
    return NextResponse.json(
      { error: `lookup failed: ${docError.message}` },
      { status: 500 },
    );
  }
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const wantsDownload = request.nextUrl.searchParams.get("download") === "1";
  const { data: signed, error: signError } = await supabase.storage
    .from("user-documents")
    .createSignedUrl(
      doc.storage_path,
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
