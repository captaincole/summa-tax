// Recovery + model-switch: embeds blocks via the local embedding model
// (EMBEDDINGS_MODEL, default ollama/embeddinggemma-2 — see
// src/refdocs/embeddings.ts) and writes the vectors back. Idempotent —
// running it twice is a no-op the second time. Requires Ollama running.
//
// Two modes:
//   (default)  only blocks with NULL embedding — recovers a `corpus sync`
//              that ran while Ollama was down, without re-paying for
//              contextualization.
//   --all      EVERY block — required after switching embedding models, and
//              after `corpus fetch` of a corpus built with a different model
//              (e.g. the Voyage-era corpus-v1 release asset), since vectors
//              from different models live in different spaces.

import {
  setBlockEmbeddings,
  listBlocksWithoutEmbeddings,
} from "../../src/mastra/db/refDocs";
import { resolveEmbeddings, embedDocuments } from "../../src/refdocs/embeddings";
import type { Command } from "../lib/cli";

async function run(argv: string[]): Promise<void> {
  const all = argv.includes("--all");

  const cfg = resolveEmbeddings();
  const allRows = await listBlocksWithoutEmbeddings({ all });

  if (allRows.length === 0) {
    console.log("[corpus reembed] no NULL-embedding blocks; nothing to do");
    return;
  }

  // Group by doc for nicer progress output.
  const byDoc = new Map<string, typeof allRows>();
  for (const r of allRows) {
    const arr = byDoc.get(r.docId) ?? [];
    arr.push(r);
    byDoc.set(r.docId, arr);
  }

  console.log(
    `[corpus reembed] ${allRows.length} block(s) across ${byDoc.size} doc(s) → ${cfg.id}${all ? " (--all: full rebuild)" : ""}`,
  );

  for (const [docId, rows] of byDoc) {
    console.log(`  ${docId}: ${rows.length} blocks`);
    const inputs = rows.map((r) => r.contextualizedText ?? r.text);
    const vectors = await embedDocuments(cfg, inputs, (done, total) =>
      console.log(`    embedding ${done}/${total}`),
    );
    await setBlockEmbeddings(
      rows.map((r, i) => ({ blockId: r.blockId, embedding: vectors[i] })),
      { embeddingModel: cfg.id },
    );
    console.log(`  ✓ ${docId} embedded`);
  }
}

export const reembedCommand: Command = {
  name: "reembed",
  summary: "Embed blocks via the active provider (recover a failed sync, or --all to switch models)",
  options: [
    {
      flag: "--all",
      desc: "re-embed every block, not just NULL ones (required after changing EMBEDDINGS_MODEL)",
    },
  ],
  run,
};
