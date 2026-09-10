import type { MastraModelConfig } from "@mastra/core/llm";

// The app has exactly three model roles:
//
//   luca      — the conversation agent. Must be multimodal (reads W-2/1099
//               images inline) and handle multi-step tool orchestration.
//   judge     — the grounding judges in workflows/reviewDecision (assess,
//               rule, queryFormulator) plus their structured-output
//               extraction passes. Text-only, narrow tasks.
//   retrieval — embeddings + rerank for reference-doc search. Not resolved
//               here: it stays Voyage (see refdocs/voyage.ts, keyed by
//               VOYAGE_API_KEY) with graceful FTS-only fallback. The corpus
//               is public IRS text, so cloud is acceptable there.
//
// Every other model string in the repo (forms-pipeline, refdocs
// contextualization) is operator-side tooling whose output ships prebuilt —
// deliberately not routed through this module.
//
// Configuration contract (per role, LUCA_* / JUDGE_*):
//
//   <ROLE>_MODEL          "provider/model" string. Without a URL it resolves
//                         through Mastra's provider registry (cloud, keyed by
//                         the provider's *_API_KEY env).
//   <ROLE>_MODEL_URL      When set, the role instead talks to this
//                         OpenAI-compatible endpoint (Ollama, vLLM,
//                         LM Studio, llama.cpp, HF endpoint, …).
//   <ROLE>_MODEL_API_KEY  Optional bearer token for that endpoint.

export type ModelRole = "luca" | "judge";

const DEFAULT_MODELS: Record<ModelRole, `${string}/${string}`> = {
  luca: "anthropic/claude-sonnet-4-6",
  judge: "anthropic/claude-haiku-4-5",
};

export function modelFor(role: ModelRole): MastraModelConfig {
  const prefix = role.toUpperCase();
  const id = (process.env[`${prefix}_MODEL`] ??
    DEFAULT_MODELS[role]) as `${string}/${string}`;
  const url = process.env[`${prefix}_MODEL_URL`];
  if (url) {
    return { id, url, apiKey: process.env[`${prefix}_MODEL_API_KEY`] };
  }
  return id;
}
