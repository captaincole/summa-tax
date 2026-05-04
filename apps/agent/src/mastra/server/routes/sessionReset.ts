import { createClient } from "@libsql/client";
import { registerApiRoute } from "@mastra/core/server";
import { resetMastraSchema } from "../../db/resetMastraSchema";
import { resetUserData } from "../../db/resetUserData";
import { cleanGeneratedFiles } from "../../fs/cleanGeneratedFiles";
import { dbUrl, pgPool } from "../storage";

// Wipes user runtime state across both stores during the libsql → Postgres
// transition: libsql for legacy domain tables (tax_facts, …) and Postgres
// for Mastra's mastra.* schema (threads, messages, traces). Mastra's PgStore
// keeps its cached schema references valid because we TRUNCATE rather than
// DROP. Same orchestration runs at boot when RESET_USER_DATA_ON_START is set.
export const sessionResetRoute = registerApiRoute("/app/session/reset", {
  method: "POST",
  handler: async (c) => {
    const resetClient = createClient({ url: dbUrl });
    const { dropped, preserved } = await resetUserData(resetClient);
    resetClient.close();
    const { truncated } = await resetMastraSchema(pgPool);
    const { deleted } = cleanGeneratedFiles();
    return c.json({
      ok: true,
      droppedTables: dropped.length,
      preservedTables: preserved.length,
      truncatedMastraTables: truncated.length,
      deletedFiles: deleted.length,
    });
  },
});
