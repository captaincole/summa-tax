import type { MiddlewareHandler } from "hono";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { getUserScopedClient } from "../db/supabase";

// Mastra middleware that, on every authed request:
//   1. Builds a per-request user-scoped Supabase client from the bearer JWT
//      and stashes it on requestContext under REQUEST_CONTEXT_KEYS.userSupabase.
//      Tools and routes pull it via that key (see tools/userContext.ts).
//   2. Decodes the JWT's `sub` claim (Supabase's standard user-UUID claim)
//      and sets MASTRA_RESOURCE_ID_KEY directly on requestContext — that's
//      the documented manual-override path for per-user memory scoping
//      (Mastra's mapUserToResourceId callback is the other way to set it).
//      We use the manual path because the MastraAuthSupabase constructor
//      silently drops `mapUserToResourceId` from its options (framework bug —
//      tracked for upstream filing). Doing it here keeps related concerns
//      (user identity → request context) in one place.
//
// We only decode the JWT, not verify it. MastraAuthSupabase still verifies
// the signature downstream via supabase.auth.getUser(token); a forged or
// expired JWT 401s before any route handler runs, so a wrong sub we may
// have stashed never gets read.

export const REQUEST_CONTEXT_KEYS = {
  userSupabase: "userSupabase",
} as const;

interface JwtPayload {
  sub?: string;
}

function decodeJwtPayload(jwt: string): JwtPayload | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(payload) as JwtPayload;
  } catch {
    return null;
  }
}

export const userSupabaseMiddleware: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("Authorization");
  const jwt = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
  if (jwt) {
    const supabase = getUserScopedClient(jwt);
    const requestContext = c.get("requestContext");
    if (requestContext && typeof requestContext.set === "function") {
      requestContext.set(REQUEST_CONTEXT_KEYS.userSupabase, supabase);
      const payload = decodeJwtPayload(jwt);
      if (payload?.sub) {
        requestContext.set(MASTRA_RESOURCE_ID_KEY, payload.sub);
      }
    }
  }
  await next();
};
