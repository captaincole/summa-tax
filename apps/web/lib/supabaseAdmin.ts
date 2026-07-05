import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Service-role Supabase client for STORAGE operations only, server-side only.
//
// Why: the storage.objects RLS policies gate access via public.filing_members
// — but domain tables (incl. filing_members) moved to the libsql app DB in
// Phase 1 step 2, so the Postgres copy is empty and user-JWT storage calls
// are denied. Access control now happens explicitly in our route handlers
// (serverDb membership checks) BEFORE any storage call; the service-role
// client then bypasses the orphaned RLS. Goes away entirely in step 4 when
// blobs move to the local filesystem.
//
// Never import from a client component; never use for domain data.

let cached: SupabaseClient | null = null;

export function getStorageAdminClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set for storage access.",
    );
  }
  cached = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
