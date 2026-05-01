// Find a block by substring match against its raw text and print its
// contextual summary alongside the original. Useful for verifying that the
// contextualization pass produced reasonable summaries.
//
// Usage:
//   npx tsx scripts/inspectBlock.ts                       # default: "never married"
//   npx tsx scripts/inspectBlock.ts "qualified dividends"
//   npx tsx scripts/inspectBlock.ts --block-id irs-1040-inst-2025::p13::b00013
import "dotenv/config";
import { parseArgs } from "node:util";
import { createClient } from "@libsql/client";

interface Row {
  block_id: string;
  doc_id: string;
  page_num: number;
  section_id: string | null;
  contextual_summary: string | null;
  text: string;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      "block-id": { type: "string" },
      limit: { type: "string", default: "1" },
    },
    allowPositionals: true,
  });
  const needle = positionals.join(" ").trim() || "never married";
  const limit = Math.max(1, Math.min(Number(values.limit), 10));

  const c = createClient({
    url: process.env.DATABASE_URL ?? "file:./wheel-of-time.db",
  });

  const sql = values["block-id"]
    ? `SELECT block_id, doc_id, page_num, section_id, contextual_summary, text
       FROM ref_blocks WHERE block_id = ? LIMIT ?`
    : `SELECT block_id, doc_id, page_num, section_id, contextual_summary, text
       FROM ref_blocks WHERE text LIKE ? LIMIT ?`;
  const args = values["block-id"]
    ? [values["block-id"], limit]
    : [`%${needle}%`, limit];

  const r = await c.execute({ sql, args });
  if (r.rows.length === 0) {
    console.log(
      values["block-id"]
        ? `No block with id "${values["block-id"]}"`
        : `No block matched "${needle}"`,
    );
    return;
  }

  for (const row of r.rows as unknown as Row[]) {
    let heading = "(unattributed)";
    if (row.section_id) {
      const s = await c.execute({
        sql: `SELECT heading FROM ref_sections WHERE section_id = ?`,
        args: [row.section_id],
      });
      heading = String(s.rows[0]?.heading ?? "(unknown)");
    }

    console.log("=".repeat(70));
    console.log(`block_id: ${row.block_id}`);
    console.log(`location: ${row.doc_id} p${row.page_num} § ${heading}`);
    console.log("=".repeat(70));

    console.log("\n--- contextual_summary (Haiku-generated, prepended before embedding) ---");
    console.log(row.contextual_summary ?? "(null — block was ingested without contextualization)");

    console.log("\n--- original IRS text ---");
    console.log(row.text);
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
