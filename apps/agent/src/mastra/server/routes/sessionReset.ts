import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { resetCurrentUserData } from "../../db/resetUserData";
import { cleanGeneratedFiles } from "../../fs/cleanGeneratedFiles";
import { pgPool } from "../storage";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

// Per-user reset triggered by the in-app "Reset" button. Wipes:
//   - This user's domain rows (tax_facts / open_questions / ai_decisions),
//     scoped automatically by RLS via the user's Supabase client.
//   - This user's Mastra threads + messages + working memory, scoped by
//     resourceId via the admin pool (Mastra tables aren't RLS-on; we filter
//     explicitly by the authenticated resourceId).
//   - Generated PDF/JSON files on disk. Currently global wipe; per-user
//     filtering is a future improvement once user-scoped paths land.
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

    const { domainRowsDeleted, mastraThreadsDeleted } =
      await resetCurrentUserData(supabase, pgPool, userId);
    const { deleted } = cleanGeneratedFiles();

    return c.json({
      ok: true,
      domainRowsDeleted,
      mastraThreadsDeleted,
      deletedFiles: deleted.length,
    });
  },
});
