import { MastraAuthSupabase } from "@mastra/auth-supabase";

// Validates Supabase JWT on every incoming request. Frontend signs in via
// supabase-js (signInWithPassword/etc.) and forwards the access token as
// `Authorization: Bearer <jwt>`. Mastra reads it on /api/agents/*,
// /api/workflows/*, and our custom /app/* routes.
//
// We pass `anonKey` explicitly — Supabase's newer projects use a
// `sb_publishable_...` key in place of the legacy `anon` JWT, and the
// MastraAuthSupabase default lookup expects an env var literally named
// SUPABASE_ANON_KEY. Naming our env var SUPABASE_PUBLISHABLE_KEY matches the
// Supabase dashboard exactly; the explicit pass-through keeps the wiring honest.
//
// mapUserToResourceId sets MASTRA_RESOURCE_ID_KEY on the request context, so
// every memory operation (mastra_threads, mastra_messages, mastra_resources)
// is automatically scoped to the authenticated user — that's the framework-
// layer per-user isolation we accepted in lieu of DB-level RLS on mastra.*.
//
// authorizeUser defaults to checking an `isAdmin` column in public.users,
// which we don't have. Override to "any signed-in user is OK"; per-row access
// is governed by RLS at the public.* tables and by mapUserToResourceId-based
// scoping at the mastra.* tables.
export function createSupabaseAuth(): MastraAuthSupabase | undefined {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return undefined;
  return new MastraAuthSupabase({
    url,
    anonKey: publishableKey,
    authorizeUser: () => true,
    mapUserToResourceId: (user) => user.id,
  });
}
