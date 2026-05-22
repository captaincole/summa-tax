import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { REQUEST_CONTEXT_KEYS } from "../server/userSupabaseMiddleware";
import { resolveOwnerFilingForYear } from "../db/filings";
import { DEMO_TAX_YEAR } from "../server/demoSession";

export interface UserContext {
  supabase: SupabaseClient;
  userId: string;
  filingId: string;
  taxYear: number;
}

// Pulls the user-scoped Supabase client and user id out of a tool's runtime
// context, then resolves the caller's active owner filing for the current
// demo tax year. Both auth values are populated upstream:
//   - userSupabase: by userSupabaseMiddleware (per-request, JWT-scoped)
//   - userId: by MastraAuthSupabase + mapUserToResourceId (set at auth time)
//
// filingId comes from a DB lookup (one round-trip per tool invocation).
// Throws when any of the four values can't be resolved — that's a
// misconfiguration we want to surface loudly rather than picking defaults.
export async function requireUserContext(
  toolContext: { requestContext?: { get: (key: string) => unknown } } | undefined,
): Promise<UserContext> {
  const rc = toolContext?.requestContext;
  if (!rc) throw new Error("requestContext missing — was this tool called outside an authed request?");
  const supabase = rc.get(REQUEST_CONTEXT_KEYS.userSupabase) as
    | SupabaseClient
    | undefined;
  const userId = rc.get(MASTRA_RESOURCE_ID_KEY) as string | undefined;
  if (!supabase) throw new Error("user-scoped Supabase client missing — userSupabaseMiddleware not registered?");
  if (!userId) throw new Error("user id missing — MastraAuthSupabase / mapUserToResourceId not configured?");
  const taxYear = DEMO_TAX_YEAR;
  const filing = await resolveOwnerFilingForYear(supabase, taxYear);
  return { supabase, userId, filingId: filing.id, taxYear };
}
