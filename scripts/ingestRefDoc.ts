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
      "out-dir": { type: "string", default: "reference-docs/extracted" },
      force: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (!values.pdf || !values["doc-id"] || !values.title) {
    console.error(
      "usage: tsx scripts/ingestRefDoc.ts --pdf <path> --doc-id <id> --title <title>" +
        " [--publisher IRS] [--tax-year 2025] [--source-url <url>] [--out-dir <dir>] [--force]",
    );
    process.exit(1);
  }

  const result = await ingestRefDoc({
    pdfPath: values.pdf,
    docId: values["doc-id"],
    title: values.title,
    publisher: values.publisher ?? "IRS",
    taxYear: values["tax-year"] ? Number(values["tax-year"]) : null,
    sourceUrl: values["source-url"] ?? null,
    canonicalOutDir: values["out-dir"] ?? "reference-docs/extracted",
    force: values.force,
  });

  console.log("ingested:");
  console.log(`  doc_id:   ${result.docId}`);
  console.log(`  sha256:   ${result.sha256.slice(0, 16)}…`);
  console.log(`  pages:    ${result.totalPages}`);
  console.log(`  chars:    ${result.totalChars}`);
  console.log(`  sections: ${result.sectionCount}`);
  console.log(`  blocks:   ${result.blockCount}`);
  console.log(`  text:     ${result.canonicalTextPath}`);
  if (result.replaced) console.log("  (replaced previous ingestion)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
