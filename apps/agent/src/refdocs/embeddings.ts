// Embedding provider. Every corpus embedding (ingest-time document vectors
// and query-time search vectors) routes through here. Embeddings run LOCALLY
// via Ollama — EmbeddingGemma 2 by default — so RAG costs nothing and needs
// no API key. Env knobs follow the "provider/model" + _URL convention of
// LUCA_MODEL / JUDGE_MODEL (see src/mastra/models.ts):
//
//   EMBEDDINGS_MODEL      default "ollama/embeddinggemma-2". Only the
//                         ollama provider is supported.
//   EMBEDDINGS_MODEL_URL  Ollama endpoint. Default http://localhost:11434.
//
// Ollama not running / model not pulled is NOT fatal: the search path
// catches embed failures and falls back to keyword (FTS) retrieval, and
// ingest writes rows without vectors (recover with `corpus reembed`).
//
// Changing the model invalidates every stored vector (different spaces,
// different dims). setBlockEmbeddings stamps ref_meta.embedding_model; the
// search path checks the stamp and degrades to FTS with a warning instead of
// silently comparing vectors from two different models. Recovery:
//   npm run corpus -- reembed --all

export interface EmbeddingsConfig {
  provider: "ollama";
  /** Bare model name, e.g. "embeddinggemma-2". */
  model: string;
  /** Full "provider/model" identity — stamped into ref_meta on write. */
  id: string;
  /** Ollama endpoint base URL. */
  url: string;
}

const DEFAULT_EMBEDDINGS_MODEL = "ollama/embeddinggemma-2";

/** Resolve the active embeddings config. Always returns one — availability
 *  is a runtime question (callers catch embed failures and degrade to FTS). */
export function resolveEmbeddings(): EmbeddingsConfig {
  const raw = process.env.EMBEDDINGS_MODEL ?? DEFAULT_EMBEDDINGS_MODEL;
  const slash = raw.indexOf("/");
  const provider = slash > 0 ? raw.slice(0, slash) : "";
  const model = slash > 0 ? raw.slice(slash + 1) : "";
  if (provider !== "ollama" || !model) {
    throw new Error(
      `EMBEDDINGS_MODEL is "${raw}" — expected "ollama/<model>" ` +
        `(e.g. ${DEFAULT_EMBEDDINGS_MODEL}); embeddings run locally via Ollama.`,
    );
  }
  return {
    provider: "ollama",
    model,
    id: raw,
    url: process.env.EMBEDDINGS_MODEL_URL ?? "http://localhost:11434",
  };
}

// ─── EmbeddingGemma task prefixes ────────────────────────────────────────
// The model card specifies task-instruction prefixes; omitting them works
// but measurably hurts retrieval precision. Applied only for embeddinggemma
// models — other Ollama embedding models get raw text.
function isEmbeddingGemma(model: string): boolean {
  return model.startsWith("embeddinggemma");
}

function gemmaDocument(text: string): string {
  return `title: none | text: ${text}`;
}

function gemmaQuery(text: string): string {
  return `task: search result | query: ${text}`;
}

// ─── Ollama embed API ────────────────────────────────────────────────────

interface OllamaEmbedResponse {
  embeddings: number[][];
}

const OLLAMA_BATCH = 32;

async function ollamaEmbed(
  cfg: EmbeddingsConfig,
  inputs: string[],
): Promise<number[][]> {
  const res = await fetch(`${cfg.url}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: cfg.model, input: inputs }),
  }).catch((err: unknown) => {
    throw new Error(
      `Ollama unreachable at ${cfg.url} (${err instanceof Error ? err.message : String(err)}) — ` +
        `is ollama running? Install: https://ollama.com, then \`ollama pull ${cfg.model}\`.`,
    );
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Ollama /api/embed ${res.status}: ${text.slice(0, 300)} ` +
        `(model=${cfg.model} — pulled? \`ollama pull ${cfg.model}\`)`,
    );
  }
  const body = (await res.json()) as OllamaEmbedResponse;
  if (!Array.isArray(body.embeddings) || body.embeddings.length !== inputs.length) {
    throw new Error(
      `Ollama /api/embed returned ${body.embeddings?.length ?? 0} vectors for ${inputs.length} inputs`,
    );
  }
  return body.embeddings;
}

// ─── Unified surface ─────────────────────────────────────────────────────

/** Embed document texts for storage. Batched; onProgress fires after each
 *  batch with the running count. */
export async function embedDocuments(
  cfg: EmbeddingsConfig,
  inputs: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  const prefixed = isEmbeddingGemma(cfg.model)
    ? inputs.map(gemmaDocument)
    : inputs;
  const vectors: number[][] = [];
  for (let i = 0; i < prefixed.length; i += OLLAMA_BATCH) {
    const vecs = await ollamaEmbed(cfg, prefixed.slice(i, i + OLLAMA_BATCH));
    vectors.push(...vecs);
    onProgress?.(vectors.length, inputs.length);
  }
  return vectors;
}

/** Embed a single search query. */
export async function embedQuery(
  cfg: EmbeddingsConfig,
  query: string,
): Promise<number[]> {
  const input = isEmbeddingGemma(cfg.model) ? gemmaQuery(query) : query;
  const [vec] = await ollamaEmbed(cfg, [input]);
  return vec;
}
