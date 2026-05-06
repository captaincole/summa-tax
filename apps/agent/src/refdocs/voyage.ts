// Voyage AI REST client. We use fetch directly rather than the voyageai SDK
// to keep the dependency surface small and the retry/batching logic explicit.
//
// Endpoints:
//   POST https://api.voyageai.com/v1/embeddings
//   POST https://api.voyageai.com/v1/rerank
//
// Pricing (as of 2026-04):
//   voyage-law-2:  $0.12 / M tokens, 1024-dim, 16K context
//   rerank-2.5:    $0.05 / M tokens (200M free)

const VOYAGE_BASE = "https://api.voyageai.com/v1";

export const EMBED_MODEL = "voyage-law-2";
export const EMBED_DIMS = 1024;
export const RERANK_MODEL = "rerank-2.5";
// Voyage embed endpoint accepts up to 128 inputs per call AND 120k tokens
// per batch. Contextualized blocks average ~1000 tokens so 128 inputs blows
// the token cap; we batch on whichever limit hits first.
export const EMBED_BATCH_MAX_INPUTS = 128;
// Voyage's per-batch ceiling is 120k tokens. We hold to 70k so a noisy
// estimator + per-block variance still leaves headroom.
export const EMBED_BATCH_MAX_TOKENS = 70_000;

// Token estimator. Empirically our contextualized blocks (Markdown-formatted
// summaries + IRS prose) hit ~2.5–3 chars/token via Voyage's tokenizer —
// denser than the typical 4 chars/token English heuristic. We use 2.5 as a
// conservative upper-bound estimate so batchByLimits doesn't blow the cap.
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 2.5);
}

/** Split inputs into batches that respect both Voyage's per-call limits.
 *  Caller iterates the returned batches and calls embed() on each. */
export function batchByLimits(inputs: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let currentTokens = 0;
  for (const s of inputs) {
    const t = estimateTokens(s);
    const wouldOverflow =
      current.length >= EMBED_BATCH_MAX_INPUTS ||
      currentTokens + t > EMBED_BATCH_MAX_TOKENS;
    if (wouldOverflow && current.length > 0) {
      out.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(s);
    currentTokens += t;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function apiKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) {
    throw new Error(
      "VOYAGE_API_KEY is not set. Copy .env.example to .env and fill it in.",
    );
  }
  return key;
}

async function postJson<T>(
  path: string,
  body: unknown,
  attempt = 0,
): Promise<T> {
  const res = await fetch(`${VOYAGE_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    return (await res.json()) as T;
  }

  // Retry on 429 (rate limit) and 5xx. Up to 4 retries with exponential
  // backoff: 500ms, 1s, 2s, 4s.
  const retryable = res.status === 429 || res.status >= 500;
  if (retryable && attempt < 4) {
    const wait = 500 * Math.pow(2, attempt);
    await new Promise((r) => setTimeout(r, wait));
    return postJson<T>(path, body, attempt + 1);
  }

  const text = await res.text().catch(() => "");
  throw new Error(`Voyage ${path} ${res.status}: ${text.slice(0, 500)}`);
}

interface EmbedResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

export interface EmbedOpts {
  /** "document" when embedding for storage; "query" when embedding a search. */
  inputType: "document" | "query";
  model?: string;
}

export async function embed(
  inputs: string[],
  opts: EmbedOpts,
): Promise<number[][]> {
  if (inputs.length === 0) return [];
  if (inputs.length > EMBED_BATCH_MAX_INPUTS) {
    throw new Error(
      `embed() got ${inputs.length} inputs, max per call is ${EMBED_BATCH_MAX_INPUTS}. Use batchByLimits() to split.`,
    );
  }
  const res = await postJson<EmbedResponse>("/embeddings", {
    input: inputs,
    model: opts.model ?? EMBED_MODEL,
    input_type: opts.inputType,
  });
  // Sort by index — Voyage returns in input order but doc says we should sort.
  return res.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function embedOne(
  input: string,
  opts: EmbedOpts,
): Promise<number[]> {
  const [vec] = await embed([input], opts);
  return vec;
}

interface RerankResponse {
  data: { index: number; relevance_score: number }[];
  model: string;
  usage: { total_tokens: number };
}

export interface RerankResult {
  /** Original index in the documents array. */
  index: number;
  score: number;
}

export async function rerank(
  query: string,
  documents: string[],
  opts: { topK?: number; model?: string } = {},
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];
  const res = await postJson<RerankResponse>("/rerank", {
    query,
    documents,
    model: opts.model ?? RERANK_MODEL,
    top_k: opts.topK,
  });
  return res.data.map((d) => ({ index: d.index, score: d.relevance_score }));
}

/** Voyage returns embeddings as JS number arrays; pgvector accepts a
 *  JSON-stringified array literal — we just JSON.stringify and pass that
 *  string to whatever query is binding the vector. */
export function vectorToSqlArg(vec: number[]): string {
  return JSON.stringify(vec);
}
