import "dotenv/config";
import { getDocument, listDocuments } from "../src/mastra/db/refDocs";
import { walkCorpus, type CorpusEntry } from "../src/refdocs/walkCorpus";
import { projectRoot } from "../src/mastra/paths";

// Read-only diff between forms/**/instructions.pdf and ref_documents in the
// local corpus DB. Exits 0 unless --strict is passed and there's any drift.

interface Categorized {
  present: CorpusEntry[];
  drift: { entry: CorpusEntry; dbSha: string }[];
  missing: CorpusEntry[];
  extra: { docId: string; sha: string }[];
}

async function categorize(): Promise<{
  walk: Awaited<ReturnType<typeof walkCorpus>>;
  cats: Categorized;
}> {
  const walk = await walkCorpus(projectRoot);
  const cats: Categorized = {
    present: [],
    drift: [],
    missing: [],
    extra: [],
  };

  const seenInRepo = new Set<string>();
  for (const entry of walk.entries) {
    seenInRepo.add(entry.sidecar.docId);
    const row = await getDocument(entry.sidecar.docId);
    if (!row) {
      cats.missing.push(entry);
    } else if (row.sha256 !== entry.fileSha) {
      cats.drift.push({ entry, dbSha: row.sha256 });
    } else {
      cats.present.push(entry);
    }
  }

  // Find DB-only docs (rows that no longer have a corresponding PDF in repo).
  for (const row of await listDocuments()) {
    if (!seenInRepo.has(row.docId)) {
      cats.extra.push({ docId: row.docId, sha: row.sha256 });
    }
  }

  return { walk, cats };
}

function format(walk: Awaited<ReturnType<typeof walkCorpus>>, cats: Categorized): string {
  const lines: string[] = [];
  const total =
    cats.present.length +
    cats.drift.length +
    cats.missing.length +
    cats.extra.length +
    walk.unconfigured.length;
  lines.push(`[refdocs:status] ${total} doc(s):`);
  lines.push(
    `  present     ${cats.present.length.toString().padStart(3)} (sha matches DB)`,
  );
  lines.push(
    `  drift       ${cats.drift.length.toString().padStart(3)} (PDF changed since last ingest)`,
  );
  lines.push(
    `  missing     ${cats.missing.length.toString().padStart(3)} (in repo, not in DB)`,
  );
  lines.push(
    `  extra       ${cats.extra.length.toString().padStart(3)} (in DB, no PDF in repo)`,
  );
  lines.push(
    `  unconfigured ${walk.unconfigured.length
      .toString()
      .padStart(2)} (PDF without sidecar)`,
  );

  if (cats.drift.length > 0) {
    lines.push("");
    lines.push("drift:");
    for (const d of cats.drift) {
      lines.push(
        `  ${d.entry.sidecar.docId}  db=${d.dbSha.slice(0, 12)}…  pdf=${d.entry.fileSha.slice(0, 12)}…`,
      );
    }
  }
  if (cats.missing.length > 0) {
    lines.push("");
    lines.push("missing:");
    for (const m of cats.missing) {
      lines.push(`  ${m.sidecar.docId}  ${m.pdfRelPath}`);
    }
  }
  if (cats.extra.length > 0) {
    lines.push("");
    lines.push("extra (DB-only):");
    for (const e of cats.extra) {
      lines.push(`  ${e.docId}  sha=${e.sha.slice(0, 12)}…`);
    }
  }
  if (walk.unconfigured.length > 0) {
    lines.push("");
    lines.push("unconfigured:");
    for (const u of walk.unconfigured) {
      lines.push(`  ${u.pdfRelPath} — ${u.reason}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const strict = process.argv.includes("--strict");
  const { walk, cats } = await categorize();
  console.log(format(walk, cats));

  if (strict) {
    const dirty =
      cats.drift.length +
      cats.missing.length +
      cats.extra.length +
      walk.unconfigured.length;
    if (dirty > 0) {
      console.error(`\n[refdocs:status] --strict: ${dirty} drift item(s)`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("[refdocs:status] failed:", err);
  process.exit(1);
});
