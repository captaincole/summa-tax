import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStorageAdminClient } from "@/lib/supabaseAdmin";
import {
  getOwnerFilingForYear,
  insertUploadedDocument,
  listUploads,
} from "@/lib/serverDb";

// Persists a user-attached file: bytes → `user-documents` Storage bucket
// (Supabase Storage until Phase 1 step 4 moves blobs local), metadata row →
// libsql app DB. The browser posts FormData here instead of writing both
// stores directly — the app DB is a server-side file it can't reach.

const DEMO_TAX_YEAR = 2025;

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function ulid(): string {
  const time = Date.now();
  let timeStr = "";
  let t = time;
  for (let i = 9; i >= 0; i--) {
    timeStr = ULID_ALPHABET[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  let randStr = "";
  for (let i = 0; i < 16; i++) randStr += ULID_ALPHABET[rand[i] % 32];
  return timeStr + randStr;
}

function slugify(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "file";
}

function extensionOf(filename: string, mimeType: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot > 0 && dot < filename.length - 1) {
    return filename.slice(dot + 1).toLowerCase();
  }
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return mimeType.slice("image/".length);
  return "bin";
}

// List the caller's uploads (Documents tab grid, home-tab quick links).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const filing = await getOwnerFilingForYear(user.id, DEMO_TAX_YEAR);
  return NextResponse.json(await listUploads(filing.id));
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "expected FormData" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const filing = await getOwnerFilingForYear(user.id, DEMO_TAX_YEAR);

  const slug = slugify(file.name);
  const ext = extensionOf(file.name, file.type);
  const storagePath = `${filing.id}/uploads/${slug}-${ulid()}.${ext}`;

  // Service-role client for storage: the bucket's RLS policies reference
  // public.filing_members, which is empty now that memberships live in
  // libsql. Access was already gated above (auth + owner-filing resolve).
  const storage = getStorageAdminClient();
  const upload = await storage.storage
    .from("user-documents")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upload.error) {
    return NextResponse.json(
      { error: `upload failed: ${upload.error.message}` },
      { status: 500 },
    );
  }

  try {
    const id = await insertUploadedDocument({
      userId: user.id,
      filingId: filing.id,
      filename: file.name,
      storagePath,
      sizeBytes: file.size,
      mimeType: file.type || null,
    });
    return NextResponse.json({ id, filename: file.name, storagePath });
  } catch (err) {
    // Roll back the orphan blob so a metadata failure doesn't leave
    // unreachable bytes in the bucket.
    await storage.storage
      .from("user-documents")
      .remove([storagePath])
      .catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `upload metadata insert failed: ${message}` },
      { status: 500 },
    );
  }
}
