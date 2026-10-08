import type { MastraModelConfig } from "@mastra/core/llm";

// The app has exactly three model roles:
//
//   luca      — the conversation agent. Must be multimodal (reads W-2/1099
//               images inline) and handle multi-step tool orchestration.
//   judge     — the grounding judges in workflows/reviewDecision (assess,
//               rule, queryFormulator) plus their structured-output
//               extraction passes. Text-only, narrow tasks.
//   retrieval — embeddings for reference-doc search. Not resolved here:
//               they route through src/refdocs/embeddings.ts
//               (EMBEDDINGS_MODEL, local Ollama — EmbeddingGemma 2 by
//               default) with graceful keyword-only (FTS) fallback when
//               Ollama isn't running.
//
// Every other model string in the repo (forms-pipeline, refdocs
// contextualization) is operator-side tooling whose output ships prebuilt —
// deliberately not routed through this module.
//
// Configuration contract (per role, LUCA_* / JUDGE_*):
//
//   <ROLE>_MODEL          REQUIRED. "provider/model" string. Without a URL it
//                         resolves through Mastra's provider registry (cloud,
//                         keyed by the provider's *_API_KEY env).
//   <ROLE>_MODEL_URL      When set, the role instead talks to this
//                         OpenAI-compatible endpoint (Ollama, vLLM,
//                         LM Studio, llama.cpp, HF endpoint, …).
//   <ROLE>_MODEL_API_KEY  Optional bearer token for that endpoint.
//
// There are deliberately NO in-code defaults: which model reads the user's
// tax data is a decision the operator makes explicitly in the env file, so a
// missing var is a startup failure, not a silent fallback. The first-run
// bootstrap (scripts/bootstrap-env.mjs) writes Anthropic values into the
// generated .env.development, so a fresh clone still boots without research.

export type ModelRole = "luca" | "judge";

// Providers whose APIs accept PDF file parts directly. Everything else
// (notably any OpenAI-compatible URL) gets PDF attachments rasterized to
// images first — see agents/pdfAttachments.ts.
const PDF_NATIVE_PROVIDERS = new Set(["anthropic", "google", "vertex"]);

export function modelReadsPdf(role: ModelRole): boolean {
  const prefix = role.toUpperCase();
  if (process.env[`${prefix}_MODEL_URL`]) return false;
  const id = process.env[`${prefix}_MODEL`] ?? "";
  return PDF_NATIVE_PROVIDERS.has(id.split("/")[0]);
}

export function modelFor(role: ModelRole): MastraModelConfig {
  const prefix = role.toUpperCase();
  const id = process.env[`${prefix}_MODEL`];
  if (!id || !/^[^/]+\/.+$/.test(id)) {
    throw new Error(
      `${prefix}_MODEL is ${id ? `"${id}"` : "not set"} — expected a ` +
        `"provider/model" string (e.g. anthropic/claude-sonnet-4-6, or ` +
        `ollama/qwen3-vl:8b with ${prefix}_MODEL_URL pointing at your ` +
        `server). Set it in apps/agent/.env.development. The app refuses ` +
        `to guess which model handles ${role === "luca" ? "conversations" : "grounding reviews"}.`,
    );
  }
  const url = process.env[`${prefix}_MODEL_URL`];
  if (url) {
    return {
      id: id as `${string}/${string}`,
      url,
      apiKey: process.env[`${prefix}_MODEL_API_KEY`],
    };
  }
  return id as `${string}/${string}`;
}
