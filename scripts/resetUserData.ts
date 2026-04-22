/**
 * Standalone CLI for dropping all user-data tables in the LibSQL database.
 * Reference tables (prefix `ref_`) are preserved. Mastra and our own db
 * modules will recreate their schemas on next use.
 *
 * Usage:
 *   npm run db:reset
 *
 * DATABASE_URL overrides the default path. Without it, the script targets
 * Mastra's public-assets DB at src/mastra/public/wheel-of-time.db
 * (that's where `mastra dev` writes at runtime).
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resetUserData } from "../src/mastra/db/resetUserData";
import { cleanGeneratedFiles } from "../src/mastra/fs/cleanGeneratedFiles";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultDbPath = resolve(projectRoot, "src/mastra/public/wheel-of-time.db");
const url = process.env.DATABASE_URL ?? `file:${defaultDbPath}`;

async function main() {
  console.log(`[db:reset] target: ${url}`);
  const client = createClient({ url });
  const { dropped, preserved } = await resetUserData(client);

  if (dropped.length === 0) {
    console.log("[db:reset] nothing to drop (empty DB?)");
  } else {
    console.log(`[db:reset] dropped ${dropped.length} tables:`);
    for (const t of dropped) console.log(`  - ${t}`);
  }
  if (preserved.length > 0) {
    console.log(`[db:reset] preserved ${preserved.length} tables:`);
    for (const t of preserved) console.log(`  - ${t}`);
  }
  client.close();

  const { deleted } = cleanGeneratedFiles();
  if (deleted.length === 0) {
    console.log("[db:reset] no generated files to wipe");
  } else {
    console.log(`[db:reset] wiped ${deleted.length} generated files:`);
    for (const f of deleted) console.log(`  - ${f}`);
  }
}

main().catch((err) => {
  console.error("[db:reset] failed:", err);
  process.exit(1);
});
