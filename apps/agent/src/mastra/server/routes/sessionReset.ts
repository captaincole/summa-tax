import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { resetCurrentUserData } from "../../db/resetUserData";
import { pgPool } from "../storage";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

// Per-user reset triggered by the in-app "Reset" button. Wipes everything
// belonging to the calling user — domain rows (tax_facts / open_questions /
// ai_decisions), Mastra threads + messages + working memory (scoped by
// resourceId), and document metadata + storage objects. RLS scopes the
// supabase-client deletes; the admin pool handles the Mastra delete since
// those tables don't carry RLS.
export const sessionResetRoute = registerApiRoute("/app/session/reset", {
  method: "POST",
  handler: async (c) => {
    const requestContext = c.get("requestContext");
    const supabase = requestContext?.get(REQUEST_CONTEXT_KEYS.userSupabase) as
      | SupabaseClient
      | undefined;
    const userId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
      | string
      | undefined;
    if (!supabase || !userId) return c.json({ error: "unauthorized" }, 401);

    const { domainRowsDeleted, mastraThreadsDeleted, documentsDeleted } =
      await resetCurrentUserData(supabase, pgPool, userId);

    return c.json({
      ok: true,
      domainRowsDeleted,
      mastraThreadsDeleted,
      documentsDeleted,
    });
  },
});
