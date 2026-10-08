// form-engine — the pipeline that turns source documents (blank fillable
// PDFs, published tax tables) into the form engine's checked-in assets:
// catalog.json widget inventories, bindings.ts, typed interfaces, tax-table
// JSON, and the promoted runtime tree. For instruction booklets → RAG, see
// `npm run corpus`.
//
//   npm run form-engine -- <command>    (or: npx tsx scripts/formEngine/cli.ts)

import { config } from "dotenv";
import { resolve } from "node:path";
import { projectRoot } from "../../src/paths";
import { runCli } from "../lib/cli";
import { generateCatalogCommand } from "./generateCatalog";
import { generateBindingsCommand } from "./generateBindings";
import { generateTypesCommand } from "./generateTypes";
import { ingestFederalTaxTableCommand } from "./ingestFederalTaxTable";
import { ingestCaTaxTableCommand } from "./ingestCaTaxTable";
import { promoteCommand } from "./promote";

// generate-catalog and generate-bindings call Anthropic; load the dev env
// uniformly so every subcommand sees the same vars regardless of invocation.
config({ path: resolve(projectRoot, ".env.development") });
config(); // plain .env, if present (never overrides already-set vars)

runCli({
  name: "form-engine",
  bin: "npm run form-engine --",
  description:
    "Form-engine asset pipeline: blank PDFs and tax tables → catalogs, bindings, types, runtime tree.",
  commands: [
    generateCatalogCommand,
    generateBindingsCommand,
    generateTypesCommand,
    ingestFederalTaxTableCommand,
    ingestCaTaxTableCommand,
    promoteCommand,
  ],
});
