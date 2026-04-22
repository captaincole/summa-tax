import "dotenv/config";
import { createClient } from "@libsql/client";

const c = createClient({
  url: process.env.DATABASE_URL ?? "file:./wheel-of-time.db",
});

async function main() {
  console.log("=== documents ===");
  const d = await c.execute(
    "SELECT doc_id, title, total_pages, total_chars FROM ref_documents",
  );
  d.rows.forEach((r) => console.log(`  ${r.doc_id}  ${r.title}  (${r.total_pages}p, ${r.total_chars} chars)`));

  console.log("\n=== first 20 sections ===");
  const s = await c.execute(
    "SELECT ordinal, heading, first_page, char_start, char_end FROM ref_sections ORDER BY ordinal LIMIT 20",
  );
  s.rows.forEach((r) => {
    const len = Number(r.char_end) - Number(r.char_start);
    console.log(`  #${r.ordinal} p${r.first_page} (${len}c)  ${String(r.heading).slice(0, 100)}`);
  });

  const queries = [
    "household employee wages",
    "standard deduction amount single",
    "medicaid waiver payments",
    "earned income credit qualifying child",
    "private delivery service address",
  ];

  for (const q of queries) {
    console.log(`\n=== FTS: ${q} ===`);
    const r = await c.execute({
      sql: `SELECT b.block_id, b.page_num, s.heading,
                   snippet(ref_blocks_fts, 5, '<<', '>>', '…', 14) AS snip,
                   bm25(ref_blocks_fts) AS score
            FROM ref_blocks_fts
            JOIN ref_blocks b ON b.block_id = ref_blocks_fts.block_id
            LEFT JOIN ref_sections s ON s.section_id = b.section_id
            WHERE ref_blocks_fts MATCH ?
            ORDER BY score LIMIT 3`,
      args: [q],
    });
    if (r.rows.length === 0) {
      console.log("  (no results)");
      continue;
    }
    r.rows.forEach((row) => {
      console.log(`  ${row.block_id}  p${row.page_num}  § ${row.heading}`);
      console.log(`    ${row.snip}`);
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
