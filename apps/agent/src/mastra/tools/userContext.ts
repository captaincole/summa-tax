import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { REQUEST_CONTEXT_KEYS } from "../server/userSupabaseMiddleware";

export interface UserContext {
  supabase: SupabaseClient;
  userId: string;
}

// Pulls the user-scoped Supabase client and user id out of a tool's runtime
// context. Both values are populated upstream:
//   - userSupabase: by userSupabaseMiddleware (per-request, JWT-scoped)
//   - userId: by MastraAuthSupabase + mapUserToResourceId (set at auth time)
//
// Throws when either is missing — that's a misconfiguration (route hit with
// no auth, or middleware not registered) and should fail loud.
export function requireUserContext(
  toolContext: { requestContext?: { get: (key: string) => unknown } } | undefined,
): UserContext {
  const rc = toolContext?.requestContext;
  if (!rc) throw new Error("requestContext missing — was this tool called outside an authed request?");
  const supabase = rc.get(REQUEST_CONTEXT_KEYS.userSupabase) as
    | SupabaseClient
    | undefined;
  const userId = rc.get(MASTRA_RESOURCE_ID_KEY) as string | undefined;
  if (!supabase) throw new Error("user-scoped Supabase client missing — userSupabaseMiddleware not registered?");
  if (!userId) throw new Error("user id missing — MastraAuthSupabase / mapUserToResourceId not configured?");
  return { supabase, userId };
}
