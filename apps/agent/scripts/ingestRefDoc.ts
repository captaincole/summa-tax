import "dotenv/config";
import { parseArgs } from "node:util";
import { ingestRefDoc } from "../src/refdocs/ingest";

async function main() {
  const { values } = parseArgs({
    options: {
      pdf: { type: "string", short: "p" },
      "doc-id": { type: "string" },
      title: { type: "string" },
      publisher: { type: "string", default: "IRS" },
      "tax-year": { type: "string" },
      "source-url": { type: "string" },
      force: { type: "boolean", default: false },
      "no-contextualize": { type: "boolean", default: false },
      "no-embed": { type: "boolean", default: false },
      "parser-style": { type: "string", default: "irs" },
    },
    strict: true,
    allowPositionals: false,
  });

  if (!values.pdf || !values["doc-id"] || !values.title) {
    console.error(
      "usage: tsx scripts/ingestRefDoc.ts --pdf <path> --doc-id <id> --title <title>" +
        " [--publisher IRS] [--tax-year 2025] [--source-url <url>] [--force]" +
        " [--parser-style irs|ftb]",
    );
    process.exit(1);
  }

  const parserStyle = values["parser-style"];
  if (parserStyle !== "irs" && parserStyle !== "ftb") {
    console.error(`--parser-style must be "irs" or "ftb" (got "${parserStyle}")`);
    process.exit(1);
  }

  const result = await ingestRefDoc({
    pdfPath: values.pdf,
    docId: values["doc-id"],
    title: values.title,
    publisher: values.publisher ?? "IRS",
    taxYear: values["tax-year"] ? Number(values["tax-year"]) : null,
    sourceUrl: values["source-url"] ?? null,
    force: values.force,
    noContextualize: values["no-contextualize"],
    noEmbed: values["no-embed"],
    parserStyle,
  });

  console.log("ingested:");
  console.log(`  doc_id:   ${result.docId}`);
  console.log(`  sha256:   ${result.sha256.slice(0, 16)}…`);
  console.log(`  pages:    ${result.totalPages}`);
  console.log(`  chars:    ${result.totalChars}`);
  console.log(`  sections: ${result.sectionCount}`);
  console.log(`  blocks:   ${result.blockCount}`);
  console.log(`  text:     ${result.canonicalTextPath}`);
  console.log(`  contextualized: ${result.contextualized ? "yes" : "no"}`);
  console.log(`  embedded:       ${result.embedded ? "yes" : "no"}`);
  if (result.replaced) console.log("  (replaced previous ingestion)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
