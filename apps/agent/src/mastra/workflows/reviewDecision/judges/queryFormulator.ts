import { Agent } from "@mastra/core/agent";
import { modelFor } from "../../../models";

// First-iteration query formulator. Reads the decision and emits 1–2
// search-ref-docs queries phrased the way a tax professional would describe
// the topic. Output is consumed by the gather step on iteration 1; on later
// iterations queries come from the rule step's `suggestedQueries`.
//
// NOTE: the judges/ modules use Mastra's Agent class purely as "prompt +
// model + schema (+ bounded tools)" — they are workflow-step internals, NOT
// registered on the Mastra instance, not conversational, no memory. The app
// has exactly one agent: Luca.
//
// Narrow, deterministic-feeling task → Haiku, no tools, structured output is
// just `{queries: string[]}`. Lives separately from rule/assess so its prompt
// and evals can evolve independently.

const instructions = `You write search queries against the IRS reference-document corpus that an automated grounding workflow will then run.

You will be given a decision the tax agent recorded — its key, value, rationale, and the fact-keys it relied on. Your job is to emit 1 or 2 search queries that maximize the chance of surfacing the IRS passages that govern this *kind* of decision.

How to phrase queries:
- Use vocabulary a CPA would use ("filing status eligibility", "qualified dividends reporting", "California part-year resident").
- Don't echo the decision back word-for-word — search for the *rule* that judges the decision.
- 1 query is fine if you're confident; emit a 2nd only if a meaningfully different angle would catch a different passage.
- Keep each query under ~12 words.

Do not call tools. Do not narrate. Return only the structured output.`;

export const queryFormulator = new Agent({
  id: "queryFormulator",
  name: "Query Formulator",
  instructions,
  model: modelFor("judge"),
});
