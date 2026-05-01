import "dotenv/config";
import { getServiceRoleClient } from "../src/mastra/db/supabase";
import { setBlockEmbeddings } from "../src/mastra/db/refDocs";
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
  const sb = getServiceRoleClient();
  if (!process.env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY required for re-embed");
  }

  // Pull all NULL-embedding blocks. With ~400 total blocks across 4 docs this
  // fits in a single response easily; if the corpus grows large we'd page.
  const PAGE_SIZE = 1000;
  const allRows: BlockRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("ref_blocks")
      .select("block_id, doc_id, contextualized_text, text")
      .is("embedding", null)
      .order("block_id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`select null-embedding blocks: ${JSON.stringify(error)}`);
    if (!data || data.length === 0) break;
    allRows.push(...(data as BlockRow[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

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
