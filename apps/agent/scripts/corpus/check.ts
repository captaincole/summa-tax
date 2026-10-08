// Row counts + per-doc embedding coverage for the local corpus DB.

import { listDocuments, tableCounts, countBlocksByDoc } from "../../src/mastra/db/refDocs";
import type { Command } from "../lib/cli";

async function run(): Promise<void> {
  const counts = await tableCounts();
  for (const [t, n] of Object.entries(counts)) {
    console.log(`${t}: count=${n}`);
  }
  // Per-doc breakdown.
  for (const d of await listDocuments()) {
    const { blocks, embedded } = await countBlocksByDoc(d.docId);
    console.log(`  ${d.docId}: blocks=${blocks}, embedded=${embedded}`);
  }
}

export const checkCommand: Command = {
  name: "check",
  summary: "Table row counts + per-doc embedding coverage",
  run,
};
