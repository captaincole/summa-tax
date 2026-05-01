import "dotenv/config";
import { getDocument } from "../src/mastra/db/refDocs";
import { ingestRefDoc } from "../src/refdocs/ingest";
import { walkCorpus, type CorpusEntry } from "../src/refdocs/walkCorpus";
import { projectRoot } from "../src/mastra/paths";

// Idempotent corpus sync. Walks reference-docs/**/*.pdf, ingests anything
// missing or sha-drifted. The ingest pipeline's own sha-skip handles re-runs
// where the PDF hasn't changed, so this is also cheap to run on every dev tick.
//
// Continues past per-doc failures so one bad PDF doesn't block the rest;
// exits non-zero at end if any failed.

interface SyncResult {
  ok: { docId: string; action: "ingested" | "replaced" | "skipped" }[];
  failed: { docId: string; error: string }[];
  unconfigured: string[];
}

async function syncOne(entry: CorpusEntry): Promise<{
  docId: string;
  action: "ingested" | "replaced" | "skipped";
}> {
  const existing = await getDocument(entry.sidecar.docId);
  const willReplace = !!existing && existing.sha256 !== entry.fileSha;

  const result = await ingestRefDoc({
    pdfPath: entry.pdfPath,
    docId: entry.sidecar.docId,
    title: entry.sidecar.title,
    publisher: entry.sidecar.publisher,
    taxYear: entry.sidecar.taxYear,
    sourceUrl: entry.sidecar.sourceUrl,
    canonicalOutDir: "reference-docs/extracted",
  });

  if (result.skipped) {
    return { docId: entry.sidecar.docId, action: "skipped" };
  }
  return {
    docId: entry.sidecar.docId,
    action: willReplace ? "replaced" : "ingested",
  };
}

async function main() {
  const walk = await walkCorpus(projectRoot);
  const result: SyncResult = { ok: [], failed: [], unconfigured: [] };

  for (const u of walk.unconfigured) {
    console.warn(`[refdocs:sync] unconfigured: ${u.pdfRelPath} — ${u.reason}`);
    result.unconfigured.push(u.pdfRelPath);
  }

  console.log(`[refdocs:sync] processing ${walk.entries.length} doc(s)`);
  for (const entry of walk.entries) {
    try {
      const r = await syncOne(entry);
      result.ok.push(r);
      console.log(`  ✓ ${r.docId} (${r.action})`);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null
            ? JSON.stringify(err)
            : String(err);
      result.failed.push({ docId: entry.sidecar.docId, error: msg });
      console.error(`  ✗ ${entry.sidecar.docId}: ${msg}`);
    }
  }

  const ingested = result.ok.filter((r) => r.action !== "skipped").length;
  const skipped = result.ok.filter((r) => r.action === "skipped").length;
  console.log(
    `\n[refdocs:sync] done: ${ingested} ingested/replaced, ${skipped} skipped, ${result.failed.length} failed, ${result.unconfigured.length} unconfigured`,
  );

  if (result.failed.length > 0 || result.unconfigured.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[refdocs:sync] fatal:", err);
  process.exit(1);
});
