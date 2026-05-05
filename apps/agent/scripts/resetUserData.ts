/**
 * Standalone CLI for wiping all user data: every row in mastra.* (Mastra
 * runtime tables) and the public.* domain tables (tax_facts, open_questions,
 * ai_decisions). Reference corpus (ref_*) is preserved. Mastra and our own
 * db modules will repopulate their schemas on next use.
 *
 * Usage:
 *   npm run db:reset
 *
 * Reads POSTGRES_URL from the environment — the same Supabase connection
 * string the agent server uses (see .env.example).
 */
import "dotenv/config";
import { Pool } from "pg";
import { resetAllUserData } from "../src/mastra/db/resetUserData";
import { cleanGeneratedFiles } from "../src/mastra/fs/cleanGeneratedFiles";

async function main() {
  if (!process.env.POSTGRES_URL) {
    console.error(
      "[db:reset] POSTGRES_URL must be set — see .env.example for the Supabase connection string format.",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const { truncated } = await resetAllUserData(pool);
    const { deleted } = cleanGeneratedFiles();

    if (truncated.length === 0) {
      console.log("[db:reset] no tables to truncate.");
    } else {
      console.log(`[db:reset] truncated ${truncated.length} tables:`);
      for (const t of truncated) console.log(`  - ${t}`);
    }
    if (deleted.length === 0) {
      console.log("[db:reset] no generated files to wipe");
    } else {
      console.log(`[db:reset] wiped ${deleted.length} generated files`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[db:reset] failed:", err);
  process.exit(1);
});
