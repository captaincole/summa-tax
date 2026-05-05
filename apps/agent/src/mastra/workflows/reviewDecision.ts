import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDecisionById,
  setDecisionVerdict,
  type AIDecisionRow,
  type AuthorityCitation,
  type Verdict,
} from "../db/aiDecisions";
import { listFactsByKeys, type TaxFactRow } from "../db/taxFacts";
import { nynaeve, nynaeveReviewSchema, type NynaeveReview } from "../agents/nynaeve";

export interface ReviewOutcome {
  decisionId: string;
  verdict: Verdict;
  reason: string;
  citations: AuthorityCitation[];
}

function renderDecisionForReview(
  decision: AIDecisionRow,
  facts: TaxFactRow[],
): string {
  const missingKeys = decision.supportingFactKeys.filter(
    (k) => !facts.some((f) => f.key === k),
  );
  const factLines = facts.length
    ? facts
        .map(
          (f) =>
            `  - ${f.key} (${f.category}): ${JSON.stringify(f.value)}` +
            (f.sourceNote ? ` [source: ${f.sourceNote}]` : ""),
        )
        .join("\n")
    : "  (none)";

  return [
    `Decision to review:`,
    ``,
    `  decisionKey:  ${decision.decisionKey}`,
    `  decision:     ${JSON.stringify(decision.decision)}`,
    `  confidence:   ${decision.confidence}`,
    `  rationale:    ${decision.rationale}`,
    decision.dissentingConsiderations
      ? `  dissenting:   ${decision.dissentingConsiderations}`
      : null,
    ``,
    `Supporting facts (loaded from tax_facts by the keys Thom cited):`,
    factLines,
    missingKeys.length
      ? `\nNOTE: Thom cited these fact keys but no matching fact exists in tax_facts: ${missingKeys.join(", ")}. That is itself a reason to consider the decision inaccurate.`
      : "",
    ``,
    `User: ${decision.userId}  Tax year: ${decision.taxYear}`,
    ``,
    `Review this decision per your instructions. Search the reference corpus for supporting IRS guidance, and return a verdict.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

// Single-line marker we use on every log emitted by this workflow. Makes it
// trivial to filter in the dev-server stdout: `grep '\[nynaeve-review\]'`.
const LOG_TAG = "[nynaeve-review]";

function logReviewStart(decision: AIDecisionRow, factCount: number) {
  const decisionShort =
    typeof decision.decision === "object"
      ? JSON.stringify(decision.decision)
      : String(decision.decision);
  console.log(
    `${LOG_TAG} start  decision=${decision.id} key=${decision.decisionKey} value=${decisionShort} confidence=${decision.confidence} facts=${factCount}`,
  );
}

function logReviewEnd(
  outcome: ReviewOutcome,
  elapsedMs: number,
) {
  const verdictTag = (() => {
    switch (outcome.verdict) {
      case "accurate": return "✓ accurate";
      case "inaccurate": return "✗ inaccurate";
      case "ungroundable": return "? ungroundable";
      case "review_failed": return "! review_failed";
    }
  })();
  const cites = outcome.citations.map((c) => c.blockId).join(", ") || "(none)";
  const reasonShort = outcome.reason.replace(/\s+/g, " ").slice(0, 240);
  console.log(
    `${LOG_TAG} done   decision=${outcome.decisionId} verdict=${verdictTag} took=${elapsedMs}ms\n` +
      `${LOG_TAG}        citations=${cites}\n` +
      `${LOG_TAG}        reason=${reasonShort}${outcome.reason.length > 240 ? "…" : ""}`,
  );
}

/**
 * Synchronous review: load the decision and its supporting facts, invoke
 * Nynaeve with a structured-output schema, persist the verdict and citations.
 * Called from record-ai-decision immediately after the decision row is written.
 *
 * Never throws for review-level failures (LLM errors, malformed output).
 * Instead, records verdict='review_failed' with the error as reason, so Thom
 * always sees a definitive state for every decision he records.
 */
export async function reviewDecision(
  supabase: SupabaseClient,
  decisionId: string,
): Promise<ReviewOutcome> {
  const t0 = Date.now();
  const decision = await getDecisionById(supabase, decisionId);
  if (!decision) {
    throw new Error(`reviewDecision: no decision with id ${decisionId}`);
  }

  const facts = await listFactsByKeys(
    supabase,
    decision.taxYear,
    decision.supportingFactKeys,
  );
  logReviewStart(decision, facts.length);

  let review: NynaeveReview;
  try {
    const result = await nynaeve.generate(renderDecisionForReview(decision, facts), {
      // Default Mastra maxSteps is 5. Empirically: an "ungroundable" verdict
      // can take a Haiku 5+ rounds of search-then-reason because the corpus
      // points at publications it doesn't include (e.g. FTB Pub 1031), and
      // Nynaeve burns steps chasing them. 10 gives her room to converge to a
      // final summary; the prompt tells her to bail at 3 searches.
      maxSteps: 10,
      structuredOutput: {
        schema: nynaeveReviewSchema,
        // Passing a model here enables multi-step tool-call + structured-output
        // loops; without it the agent can only do one or the other. Using the
        // same Haiku model keeps cost/latency flat.
        model: "anthropic/claude-haiku-4-5",
        errorStrategy: "strict",
      },
    });
    const obj = (result as { object?: NynaeveReview }).object;
    if (!obj) {
      throw new Error(
        "Nynaeve returned no structured output; check model/schema compatibility.",
      );
    }
    review = obj;
  } catch (err) {
    const reason =
      err instanceof Error ? err.message : `unknown review failure: ${String(err)}`;
    await setDecisionVerdict(supabase, decisionId, "review_failed", reason, null);
    const outcome: ReviewOutcome = {
      decisionId,
      verdict: "review_failed",
      reason,
      citations: [],
    };
    logReviewEnd(outcome, Date.now() - t0);
    return outcome;
  }

  const citations: AuthorityCitation[] = review.citations.map((c) => ({
    blockId: c.blockId,
    quote: c.quote,
  }));

  await setDecisionVerdict(
    supabase,
    decisionId,
    review.verdict,
    review.reason,
    citations.length > 0 ? citations : null,
  );

  const outcome: ReviewOutcome = {
    decisionId,
    verdict: review.verdict,
    reason: review.reason,
    citations,
  };
  logReviewEnd(outcome, Date.now() - t0);
  return outcome;
}
