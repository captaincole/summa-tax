import { createClient } from "@/lib/supabase/client";
import { getUserId } from "@/lib/auth";

// Persists a user-attached file to the `user-documents` Storage bucket
// (`uploads` category) and inserts a metadata row in `user_documents`. RLS
// scopes both operations to the authenticated user — the same JWT that
// drives the rest of the supabase-js client.
//
// This runs in parallel with the chat stream: bytes go browser → Supabase
// directly (no agent in the path) while the same bytes also flow through
// the chat message as base64 for the agent's vision-based extraction.

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

export interface UploadResult {
  id: string;
  filename: string;
  storagePath: string;
}

export async function uploadDocument(file: File): Promise<UploadResult> {
  const userId = await getUserId();
  if (!userId) throw new Error("Not signed in — cannot upload");

  const supabase = createClient();
  const slug = slugify(file.name);
  const ext = extensionOf(file.name, file.type);
  const storagePath = `${userId}/uploads/${slug}-${ulid()}.${ext}`;

  const upload = await supabase.storage
    .from("user-documents")
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (upload.error) {
    throw new Error(`upload failed: ${upload.error.message}`);
  }

  const { data, error } = await supabase
    .from("user_documents")
    .insert({
      user_id: userId,
      category: "uploads",
      filename: file.name,
      storage_path: storagePath,
      size_bytes: file.size,
      mime_type: file.type || null,
    })
    .select("id")
    .single();

  if (error) {
    await supabase.storage
      .from("user-documents")
      .remove([storagePath])
      .catch(() => {});
    throw new Error(`upload metadata insert failed: ${error.message}`);
  }

  return { id: data.id as string, filename: file.name, storagePath };
}
