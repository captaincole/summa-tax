// Fetch the prebuilt reference corpus into .data/corpus.db.
//
// Resolution order:
//   1. .data/corpus.db already present + sha matches manifest → done.
//      (Present with a DIFFERENT sha is fine too — assume a locally-extended
//      corpus via `corpus sync`; we won't clobber it. Use --force to replace.)
//   2. CORPUS_SEED_PATH env or a local seed file → copy.
//   3. manifest url (GitHub Release asset) → download + sha256-verify.
//
// The corpus ships as a release asset rather than in git because it grows
// with scenario coverage (50 states ≈ 50+ instruction booklets); see
// seed/corpus.manifest.json.

import { createHash } from "node:crypto";
import { mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "../lib/cli";

const HERE = dirname(fileURLToPath(import.meta.url)); // apps/agent/scripts/corpus
const MANIFEST_PATH = resolve(HERE, "../../seed/corpus.manifest.json");
const DEFAULT_TARGET = resolve(HERE, "../../.data/corpus.db");

interface Manifest {
  version: string;
  file: string;
  sha256: string;
  sizeBytes: number;
  url: string;
}

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function run(argv: string[]): Promise<void> {
  const force = argv.includes("--force");
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  const target = process.env.CORPUS_DB_PATH
    ? resolve(process.env.CORPUS_DB_PATH)
    : DEFAULT_TARGET;
  mkdirSync(dirname(target), { recursive: true });

  // 1. Already there?
  if (existsSync(target) && !force) {
    const sha = sha256Of(target);
    if (sha === manifest.sha256) {
      console.log(`[corpus fetch] up to date (${manifest.version}) at ${target}`);
    } else {
      console.log(
        `[corpus fetch] ${target} exists with a different sha — leaving it alone ` +
          `(locally extended corpus?). Use --force to replace with ${manifest.version}.`,
      );
    }
    return;
  }

  // 2. Local seed (dev / private-phase path).
  const seedPath = process.env.CORPUS_SEED_PATH
    ? resolve(process.env.CORPUS_SEED_PATH)
    : resolve(HERE, "../../seed/corpus.db");
  if (existsSync(seedPath)) {
    copyFileSync(seedPath, target);
    console.log(`[corpus fetch] seeded from ${seedPath} → ${target}`);
    await checkEmbeddingStamp();
    return;
  }

  // 3. Download from the release asset.
  if (!manifest.url) {
    console.error(
      `[corpus fetch] no corpus available: ${target} missing, no local seed at ` +
        `${seedPath}, and the manifest has no url (corpus release not published yet).\n` +
        `Options: set CORPUS_SEED_PATH to a corpus.db, or build one with ` +
        `'npm run corpus -- sync' (needs ANTHROPIC_API_KEY; Ollama for embeddings). ` +
        `The app runs without a corpus — grounding reviews ` +
        `will return needs_more_facts until one exists.`,
    );
    process.exit(1);
  }

  console.log(`[corpus fetch] downloading ${manifest.version} (${(manifest.sizeBytes / 1e6).toFixed(1)} MB)…`);
  const res = await fetch(manifest.url);
  if (!res.ok) {
    console.error(`[corpus fetch] download failed: HTTP ${res.status} from ${manifest.url}`);
    process.exit(1);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== manifest.sha256) {
    console.error(
      `[corpus fetch] sha256 mismatch — expected ${manifest.sha256}, got ${sha}. Not installing.`,
    );
    process.exit(1);
  }
  writeFileSync(target, bytes);
  console.log(`[corpus fetch] installed ${manifest.version} → ${target}`);
  await checkEmbeddingStamp();
}

// Compare the installed corpus's embedding-model stamp against the active
// local model. On mismatch, search runs keyword-only until the vectors are
// rebuilt (~4 min, free, needs Ollama) — say so now rather than at query time.
// getCorpusDb resolves the same CORPUS_DB_PATH/default this script installed to.
async function checkEmbeddingStamp(): Promise<void> {
  const { storedEmbeddingModel } = await import("../../src/mastra/db/refDocs");
  const { resolveEmbeddings } = await import("../../src/refdocs/embeddings");
  const stored = await storedEmbeddingModel();
  const active = resolveEmbeddings().id;
  if (stored === active) {
    console.log(`[corpus fetch] embeddings match the active model (${active}) — RAG ready.`);
  } else {
    console.log(
      `[corpus fetch] corpus embeddings are ${stored ?? "unstamped"} but the active ` +
        `model is ${active} — run 'npm run corpus -- reembed --all' to rebuild them ` +
        `locally; until then reference search is keyword-only.`,
    );
  }
}

export const fetchCommand: Command = {
  name: "fetch",
  summary: "Install the prebuilt corpus.db (local seed or sha-verified release download)",
  options: [
    { flag: "--force", desc: "replace an existing corpus.db even if its sha differs" },
  ],
  run,
};
