import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { searchRefDocsTool, citeRefDocTool } from "../src/mastra/tools/refDocs";

type Check = { name: string; pass: boolean; detail?: string };

const checks: Check[] = [];

function record(name: string, pass: boolean, detail?: string) {
  checks.push({ name, pass, detail });
  const mark = pass ? "✓" : "✗";
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

// Known good lookups: natural-language queries that should surface a
// predictable section. Add new rows here as we find corners of the doc that
// matter for Thom's decisions. Use `topSection` substring-match against the
// heading of the top hit.
const SPOT_QUERIES: Array<{ query: string; docId: string; topSection: RegExp }> = [
  {
    query: "household employee wages",
    docId: "irs-1040-inst-2025",
    topSection: /household em/i,
  },
  {
    query: "medicaid waiver payments",
    docId: "irs-1040-inst-2025",
    topSection: /medicaid waiver/i,
  },
  {
    query: "qualified dividends",
    docId: "irs-1040-inst-2025",
    topSection: /qualified dividends|line 3a/i,
  },
  {
    query: "earned income credit qualifying child",
    docId: "irs-1040-inst-2025",
    topSection: /earned income|eic|line 27/i,
  },
];

async function main() {
  const c = createClient({
    url: process.env.DATABASE_URL ?? "file:./wheel-of-time.db",
  });

  console.log("Round-trip verification (block.text vs canonical slice)");
  const docs = await c.execute(
    `SELECT doc_id, canonical_text_path, total_chars FROM ref_documents`,
  );
  for (const d of docs.rows) {
    const docId = String(d.doc_id);
    const canonicalPath = String(d.canonical_text_path);
    const canonical = await readFile(canonicalPath, "utf8");

    if (canonical.length !== Number(d.total_chars)) {
      record(
        `${docId} canonical length matches`,
        false,
        `db=${d.total_chars} file=${canonical.length}`,
      );
      continue;
    }
    record(`${docId} canonical length matches`, true);

    const blocks = await c.execute({
      sql: `SELECT block_id, text, char_start, char_end FROM ref_blocks WHERE doc_id = ?`,
      args: [docId],
    });
    let mismatches = 0;
    let firstMismatch: string | null = null;
    for (const b of blocks.rows) {
      const sliced = canonical.slice(Number(b.char_start), Number(b.char_end));
      if (sliced !== String(b.text)) {
        mismatches += 1;
        if (!firstMismatch) firstMismatch = String(b.block_id);
      }
    }
    record(
      `${docId} all ${blocks.rows.length} blocks match canonical slice`,
      mismatches === 0,
      mismatches === 0 ? undefined : `${mismatches} mismatches, first: ${firstMismatch}`,
    );
  }

  console.log("\nSearch tool smoke tests");
  for (const sq of SPOT_QUERIES) {
    // Use direct execute per CLAUDE.md note on Mastra tool invocation outside agents.
    const res = await (searchRefDocsTool as any).execute({
      query: sq.query,
      docId: sq.docId,
      limit: 3,
    });
    const top = res.results[0];
    if (!top) {
      record(`search "${sq.query}" returns results`, false, "no hits");
      continue;
    }
    const heading = top.sectionHeading ?? "(no section)";
    const matches = sq.topSection.test(heading);
    record(
      `search "${sq.query}" → "${heading.slice(0, 60)}"`,
      matches,
      matches ? undefined : `expected ~/${sq.topSection.source}/`,
    );
  }

  console.log("\nCite tool smoke test (top hit of first query)");
  const firstQuery = SPOT_QUERIES[0];
  const firstRes = await (searchRefDocsTool as any).execute({
    query: firstQuery.query,
    docId: firstQuery.docId,
    limit: 1,
  });
  const hit = firstRes.results[0];
  if (!hit) {
    record("cite tool: found top hit to cite", false);
  } else {
    record("cite tool: found top hit to cite", true, hit.blockId);
    const cited = await (citeRefDocTool as any).execute({ blockId: hit.blockId });
    record("cite tool: found=true", !!cited.found);
    record(
      "cite tool: text matches search hit text",
      cited.block?.text === hit.text,
    );
    record(
      "cite tool: citation string present",
      typeof cited.block?.citation === "string" && cited.block.citation.length > 0,
      cited.block?.citation,
    );
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(
    `\n${checks.length - failed.length}/${checks.length} checks passed`,
  );
  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
