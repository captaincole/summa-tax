import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role client for the agent server. Used today only for the reference
// corpus (ref_documents / ref_pages / ref_sections / ref_blocks). When user
// data migrates to Supabase later, those reads will move to a per-request
// JWT-scoped client built from the same SUPABASE_URL — at which point this
// module grows a `forUser(jwt)` factory rather than centralizing now.

const SUPABASE_URL = process.env.SUPABASE_URL;
// `sb_secret_…` (new naming) replaces the legacy `service_role` JWT. Both
// behave the same at the API layer — bypass RLS, full read/write — but only
// one of them ships in new projects, so we prefer the new name.
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

let cached: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (cached) return cached;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY must be set. Add them to .env.development for local runs and to Render env vars for prod.",
    );
  }
  cached = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
      // Server-side use; we never touch the auth flow on this client.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}
