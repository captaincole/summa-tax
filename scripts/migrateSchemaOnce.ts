// One-shot to force `ensureSchema()` to run and verify the migration
// applies cleanly on whatever DB shape currently exists.
import "dotenv/config";
import { searchRefDocs } from "../src/mastra/db/refDocs";

async function main() {
  await searchRefDocs({ query: "smoke" });
  console.log("schema migration applied without error");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
