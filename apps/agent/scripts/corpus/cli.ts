// corpus — the RAG knowledge base, end to end: get instruction documents
// into corpus.db (sync/ingest/status/reembed) and operate on the db itself
// (fetch/check/search).
//
//   npm run corpus -- <command>       (or: npx tsx scripts/corpus/cli.ts)

import "dotenv/config";
import { runCli } from "../lib/cli";
import { fetchCommand } from "./fetch";
import { syncCommand } from "./sync";
import { statusCommand } from "./status";
import { ingestCommand } from "./ingest";
import { reembedCommand } from "./reembed";
import { checkCommand } from "./check";
import { searchCommand } from "./search";

runCli({
  name: "corpus",
  bin: "npm run corpus --",
  description:
    "Reference corpus for RAG grounding: ingest instruction PDFs, fetch/inspect/search corpus.db.",
  commands: [
    fetchCommand,
    syncCommand,
    statusCommand,
    ingestCommand,
    reembedCommand,
    checkCommand,
    searchCommand,
  ],
});
