import "dotenv/config";
import {
  setBlockEmbeddings,
  listBlocksWithoutEmbeddings,
} from "../src/mastra/db/refDocs";
import { embed, batchByLimits } from "../src/refdocs/voyage";

// Recovery script. Finds blocks with NULL embedding, embeds their
// contextualized_text (or text fallback) via Voyage, and writes the vectors
// back. Idempotent — running it twice is a no-op the second time.
//
// Use case: setBlockEmbeddings failed on a previous ingest, leaving us with
// rows + contextualized_text in DB but no embeddings. Re-running refdocs:sync
// would re-pay Haiku for contextualization (~$2 for the 4 docs); this is
// ~$0.10 because we only re-do the cheap step.

interface BlockRow {
  block_id: string;
  doc_id: string;
  contextualized_text: string | null;
  text: string;
}

async function main() {
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY required for re-embed");
  }

  const allRows: BlockRow[] = (await listBlocksWithoutEmbeddings()).map((b) => ({
    block_id: b.blockId,
    doc_id: b.docId,
    contextualized_text: b.contextualizedText,
    text: b.text,
  }));

  if (allRows.length === 0) {
    console.log("[refdocs:reembed] no NULL-embedding blocks; nothing to do");
    return;
  }

  // Group by doc for nicer progress output.
  const byDoc = new Map<string, BlockRow[]>();
  for (const r of allRows) {
    const arr = byDoc.get(r.doc_id) ?? [];
    arr.push(r);
    byDoc.set(r.doc_id, arr);
  }

  console.log(
    `[refdocs:reembed] ${allRows.length} blocks across ${byDoc.size} doc(s) to embed`,
  );

  for (const [docId, rows] of byDoc) {
    console.log(`  ${docId}: ${rows.length} blocks`);
    const inputs = rows.map((r) => r.contextualized_text ?? r.text);
    const batches = batchByLimits(inputs);
    const vectors: number[][] = [];
    let processed = 0;
    for (const batch of batches) {
      const batchVecs = await embed(batch, { inputType: "document" });
      vectors.push(...batchVecs);
      processed += batch.length;
      console.log(`    embedding ${processed}/${inputs.length}`);
    }
    await setBlockEmbeddings(
      rows.map((r, i) => ({ blockId: r.block_id, embedding: vectors[i] })),
    );
    console.log(`  ✓ ${docId} embedded`);
  }
}

main().catch((err) => {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null
        ? JSON.stringify(err)
        : String(err);
  console.error("[refdocs:reembed] failed:", msg);
  process.exit(1);
});
