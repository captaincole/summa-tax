import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { resetCurrentUserData } from "../../db/resetUserData";

// Per-user reset (POST /app/session/reset). Wipes everything belonging to
// the calling user — domain rows (explicit user_id scoping in libsql),
// Mastra threads + messages + working memory (scoped by resourceId), and
// document metadata rows + their local blob files. The web UI's affordance
// for this evolved into "Delete filing" (DELETE /app/filings/:id); this
// endpoint remains for API callers.
export const sessionResetRoute = registerApiRoute("/app/session/reset", {
  method: "POST",
  handler: async (c) => {
    const requestContext = c.get("requestContext");
    const userId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
      | string
      | undefined;
    if (!userId) return c.json({ error: "unauthorized" }, 401);

    const { domainRowsDeleted, mastraThreadsDeleted, documentsDeleted } =
      await resetCurrentUserData(userId);

    return c.json({
      ok: true,
      domainRowsDeleted,
      mastraThreadsDeleted,
      documentsDeleted,
    });
  },
});
