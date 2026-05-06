import type { SupabaseClient } from "@supabase/supabase-js";
import { registerApiRoute } from "@mastra/core/server";
import {
  getDocumentById,
  signDocumentUrl,
} from "../../db/userDocuments";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

// User-document download endpoint. The public URL is opaque
// (/documents/{uuid}) so chat-history links carry the row's UUID rather than
// guessable filenames. We auth-check on every hit, look up the metadata row
// (RLS scopes to the current user — a row that doesn't belong to them
// returns a maybeSingle null, surfaced as 404), then mint a short-lived
// signed URL pointing at the actual storage path and 302-redirect.
//
// Bytes don't flow through the agent — they go browser → Supabase Storage
// directly via the signed URL. The agent only signs.
export const documentsRoute = registerApiRoute("/documents/:id", {
  method: "GET",
  handler: async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Missing id" }, 400);

    const requestContext = c.get("requestContext");
    const supabase = requestContext?.get(REQUEST_CONTEXT_KEYS.userSupabase) as
      | SupabaseClient
      | undefined;
    if (!supabase) return c.json({ error: "unauthorized" }, 401);

    const doc = await getDocumentById(supabase, id);
    if (!doc) return c.json({ error: "Not found" }, 404);

    const signedUrl = await signDocumentUrl(supabase, doc.storagePath, 60);
    return c.redirect(signedUrl, 302);
  },
});
