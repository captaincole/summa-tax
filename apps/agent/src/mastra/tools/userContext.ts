import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { REQUEST_CONTEXT_KEYS } from "../server/ownerMiddleware";
import { resolveOwnerFilingForYear } from "../db/filings";
import type { Scope } from "../db/appDb";
import { DEMO_TAX_YEAR } from "../server/demoSession";

export interface UserContext {
  userId: string;
  filingId: string;
  taxYear: number;
  /** Explicit query scoping for the libsql domain helpers — the RLS
   *  replacement. */
  scope: Scope;
  /** JWT email claim — enrichment for the engine's authEmail field. */
  authEmail: string | null;
}

// Pulls the user identity out of a tool's runtime context, then resolves the
// caller's active owner filing for the current demo tax year from the libsql
// app DB. Identity is populated upstream by ownerMiddleware (the instance
// owner from app.db — single-user model).
//
// filingId comes from a DB lookup (one local libsql read per tool invocation).
// Throws when any required value can't be resolved — that's a
// misconfiguration we want to surface loudly rather than picking defaults.
export async function requireUserContext(
  toolContext: { requestContext?: { get: (key: string) => unknown } } | undefined,
): Promise<UserContext> {
  const rc = toolContext?.requestContext;
  if (!rc) throw new Error("requestContext missing — was this tool called outside an authed request?");
  const userId = rc.get(MASTRA_RESOURCE_ID_KEY) as string | undefined;
  const authEmail =
    (rc.get(REQUEST_CONTEXT_KEYS.userEmail) as string | undefined) ?? null;
  if (!userId) throw new Error("owner missing — complete first-run setup in the web app before chatting");
  const taxYear = DEMO_TAX_YEAR;
  const filing = await resolveOwnerFilingForYear(userId, taxYear);
  return {
    userId,
    filingId: filing.id,
    taxYear,
    scope: { userId, filingId: filing.id },
    authEmail,
  };
}
