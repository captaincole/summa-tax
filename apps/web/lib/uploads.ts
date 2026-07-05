// Uploads a user-attached file via the /api/uploads Route Handler, which
// authenticates from the session cookie, streams the bytes to the
// `user-documents` Storage bucket (blobs stay in Supabase Storage until
// Phase 1 step 4), and inserts the metadata row in the libsql app DB.
//
// The browser used to write both stores directly; with domain metadata in a
// server-side file, the whole persist path moved behind the API route. The
// same bytes still flow through the chat message as base64 for the agent's
// vision-based extraction, in parallel with this call.

export interface UploadResult {
  id: string;
  filename: string;
  storagePath: string;
}

export async function uploadDocument(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  if (!res.ok) {
    let message = `upload failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return (await res.json()) as UploadResult;
}
