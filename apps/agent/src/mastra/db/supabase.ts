import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Two client flavors live here:
//   - getServiceRoleClient() — uses SUPABASE_SECRET_KEY, bypasses RLS. Used
//     for the reference corpus (ref_*) and for admin operations that need
//     cross-user reach.
//   - getUserScopedClient(jwt) — uses SUPABASE_PUBLISHABLE_KEY plus a per-
//     request user JWT in the Authorization header. PostgREST honors the JWT,
//     auth.uid() resolves to that user, and RLS on public.* domain tables
//     scopes every query to that user automatically.
//
// `sb_secret_…` and `sb_publishable_…` (new naming) replace the legacy
// `service_role` / `anon` JWTs. Same roles at the API layer.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

let cachedServiceRole: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (cachedServiceRole) return cachedServiceRole;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SECRET_KEY must be set. Add them to .env.development for local runs and to Render env vars for prod.",
    );
  }
  cachedServiceRole = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedServiceRole;
}

// Builds a fresh user-scoped client per call. Don't cache — each request has
// its own JWT, and stale caches across users would be a cross-tenant bug.
export function getUserScopedClient(userJwt: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set. Add them to .env.development for local runs and to Render env vars for prod.",
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
