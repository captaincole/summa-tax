// doctor — one-shot setup diagnostics: machine info, env config, data
// files, and local model servers (Ollama, LM Studio).
//
//   npm run doctor        (or: npx tsx scripts/doctor.ts from apps/agent/)
//
// Read-only: probes the machine and local HTTP endpoints, writes nothing.
// Use it to answer "why is semantic search falling back to keyword?" or
// "what does this box actually have installed?" before debugging deeper.

import { config } from "dotenv";
import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "../src/paths";

// Same layering the dev server sees: .env first, .env.development fills
// the gaps (dotenv never overrides already-set keys).
config({ path: resolve(projectRoot, ".env"), quiet: true });
config({ path: resolve(projectRoot, ".env.development"), quiet: true });

const OK = "✓";
const BAD = "✗";
const DIM = "–";

function section(title: string): void {
  console.log(`\n${title}`);
}

function row(label: string, value: string): void {
  console.log(`  ${label.padEnd(19)} ${value}`);
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

// ─── Machine ────────────────────────────────────────────────────────────

function machineSection(): void {
  section("Machine");
  row("OS", `${os.platform()} ${os.release()} (${os.arch()})`);
  const cpus = os.cpus();
  row("CPU", `${cpus[0]?.model ?? "unknown"} (${cpus.length} cores)`);
  row("RAM", `${gb(os.totalmem())} total, ${gb(os.freemem())} free`);
  row("Node", process.version);
}

// ─── Config ─────────────────────────────────────────────────────────────

const DEFAULT_EMBEDDINGS_MODEL = "ollama/embeddinggemma-2";

function configSection(): void {
  section("Config (.env + .env.development)");
  for (const key of ["LUCA_MODEL", "JUDGE_MODEL"]) {
    const v = process.env[key];
    row(key, v ?? `${BAD} unset — the app refuses to start without it`);
  }
  row("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY ? `${OK} set` : `${DIM} unset`);
  const embeddings = process.env.EMBEDDINGS_MODEL;
  row(
    "EMBEDDINGS_MODEL",
    embeddings ?? `${DEFAULT_EMBEDDINGS_MODEL} (default)`,
  );
  for (const key of ["LUCA_MODEL_URL", "JUDGE_MODEL_URL", "EMBEDDINGS_MODEL_URL"]) {
    const v = process.env[key];
    if (v) row(key, v);
  }
}

// ─── Data files ─────────────────────────────────────────────────────────

function dataSection(): void {
  section("Data files");
  const entries: [string, string][] = [
    ["corpus.db", process.env.CORPUS_DB_PATH ?? resolve(projectRoot, ".data/corpus.db")],
    ["app.db", process.env.APP_DB_PATH ?? resolve(projectRoot, ".data/app.db")],
    ["mastra.db", process.env.MASTRA_DB_PATH ?? resolve(projectRoot, ".data/mastra.db")],
  ];
  for (const [label, path] of entries) {
    row(label, existsSync(path) ? `${OK} ${mb(statSync(path).size)}` : `${BAD} missing (${path})`);
  }
  const docs = process.env.DOCUMENTS_PATH ?? resolve(projectRoot, ".data/documents");
  row(
    "documents/",
    existsSync(docs)
      ? `${OK} ${readdirSync(docs).length} filing dir(s)`
      : `${DIM} none yet`,
  );
}

// ─── Model servers ──────────────────────────────────────────────────────

function binaryVersion(bin: string, args: string[]): string | null {
  const res = spawnSync(bin, args, { encoding: "utf8", timeout: 5_000 });
  if (res.error || res.status !== 0) return null;
  return (res.stdout || res.stderr).trim().split("\n")[0];
}

async function probeJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

interface OllamaStatus {
  binary: string | null;
  serverUrl: string;
  serverVersion: string | null;
  /** Pulled model names, null when the server is down. */
  models: string[] | null;
}

async function probeOllama(): Promise<OllamaStatus> {
  const serverUrl = process.env.EMBEDDINGS_MODEL_URL ?? "http://localhost:11434";
  const version = (await probeJson(`${serverUrl}/api/version`)) as
    | { version?: string }
    | null;
  const tags = version
    ? ((await probeJson(`${serverUrl}/api/tags`)) as {
        models?: { name?: string }[];
      } | null)
    : null;
  return {
    binary: binaryVersion("ollama", ["--version"]),
    serverUrl,
    serverVersion: version?.version ?? null,
    models: tags?.models?.flatMap((m) => (m.name ? [m.name] : [])) ?? null,
  };
}

async function probeLmStudio(): Promise<{ binary: string | null; serverUp: boolean }> {
  return {
    binary: binaryVersion("lms", ["--version"]),
    serverUp: (await probeJson("http://localhost:1234/v1/models")) !== null,
  };
}

/** The bare model name Ollama knows, e.g. "embeddinggemma-2" from
 *  "ollama/embeddinggemma-2". Tags may carry a ":latest" suffix. */
function embeddingModelName(): string {
  const raw = process.env.EMBEDDINGS_MODEL ?? DEFAULT_EMBEDDINGS_MODEL;
  return raw.replace(/^ollama\//, "");
}

function hasModel(models: string[], name: string): boolean {
  return models.some((m) => m === name || m.startsWith(`${name}:`));
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Summa doctor — machine, config, and model-server diagnostics");

  machineSection();
  configSection();
  dataSection();

  const [ollama, lmStudio] = await Promise.all([probeOllama(), probeLmStudio()]);
  const wanted = embeddingModelName();

  section("Model servers");
  const ollamaBits = [
    ollama.binary ? `binary ${OK} ${ollama.binary}` : `binary ${BAD} not on PATH`,
    ollama.serverVersion
      ? `server ${OK} ${ollama.serverUrl} (v${ollama.serverVersion})`
      : `server ${BAD} ${ollama.serverUrl} not responding`,
    ollama.models
      ? hasModel(ollama.models, wanted)
        ? `${wanted} ${OK} pulled`
        : `${wanted} ${BAD} not pulled (${ollama.models.length} other model(s))`
      : `${wanted} ${DIM} unknown`,
  ];
  row("Ollama", ollamaBits.join(" · "));
  row(
    "LM Studio",
    [
      lmStudio.binary ? `binary ${OK} ${lmStudio.binary}` : `binary ${DIM} not on PATH`,
      lmStudio.serverUp ? `server ${OK} :1234` : `server ${DIM} :1234 not responding`,
    ].join(" · "),
  );

  section("Verdict");
  const semanticReady =
    ollama.serverVersion !== null &&
    ollama.models !== null &&
    hasModel(ollama.models, wanted);
  if (semanticReady) {
    console.log(`  ${OK} Semantic (RAG) search is ready — Ollama is serving ${wanted}.`);
  } else {
    console.log(
      `  ${BAD} Semantic search will fall back to keyword (FTS) matching.`,
    );
    if (!ollama.binary) {
      console.log(`    → Install Ollama: https://ollama.com (or \`brew install ollama\`).`);
    } else if (!ollama.serverVersion) {
      console.log(`    → Start the server: \`ollama serve\` (or open the Ollama app).`);
    } else {
      console.log(`    → Pull the model: \`ollama pull ${wanted}\` (~1.3 GB).`);
    }
  }
  console.log();
}

main().catch((err) => {
  console.error("doctor failed:", err);
  process.exit(1);
});
