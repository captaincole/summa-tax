import "dotenv/config";
import { resolve } from "node:path";
import { getDocument } from "../src/mastra/db/refDocs";
import { ingestRefDoc } from "../src/refdocs/ingest";

interface SeedDoc {
  docId: string;
  pdfPath: string;
  title: string;
  publisher: string;
  taxYear: number;
  sourceUrl?: string;
}

const DOCS: SeedDoc[] = [
  {
    docId: "irs-1040-inst-2025",
    pdfPath: "reference-docs/2025-1040-1040sr-ref-irs.pdf",
    title: "2025 Instructions for Form 1040 and 1040-SR",
    publisher: "IRS",
    taxYear: 2025,
  },
];

async function seedDoc(doc: SeedDoc) {
  const existing = await getDocument(doc.docId);
  if (existing) {
    console.log(`[seed-ref-corpus] ${doc.docId} already ingested — skipping`);
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      `[seed-ref-corpus] ANTHROPIC_API_KEY required to ingest ${doc.docId} (contextualization step)`,
    );
  }

  console.log(`[seed-ref-corpus] ingesting ${doc.docId} from ${doc.pdfPath}`);
  const result = await ingestRefDoc({
    pdfPath: resolve(doc.pdfPath),
    docId: doc.docId,
    title: doc.title,
    publisher: doc.publisher,
    taxYear: doc.taxYear,
    sourceUrl: doc.sourceUrl ?? null,
    canonicalOutDir: "reference-docs/extracted",
  });

  console.log(
    `[seed-ref-corpus] ingested ${result.docId}: ${result.blockCount} blocks` +
      ` (contextualized=${result.contextualized}, embedded=${result.embedded})`,
  );
}

async function main() {
  for (const doc of DOCS) {
    await seedDoc(doc);
  }
  console.log("[seed-ref-corpus] done");
}

main().catch((err) => {
  console.error("[seed-ref-corpus] failed:", err);
  process.exit(1);
});
