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
    `Taxpayer: ${decision.taxpayerId}  Tax year: ${decision.year}`,
    ``,
    `Review this decision per your instructions. Search the reference corpus for supporting IRS guidance, and return a verdict.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
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
  decisionId: string,
): Promise<ReviewOutcome> {
  const decision = await getDecisionById(decisionId);
  if (!decision) {
    throw new Error(`reviewDecision: no decision with id ${decisionId}`);
  }

  const facts = await listFactsByKeys(
    decision.taxpayerId,
    decision.year,
    decision.supportingFactKeys,
  );

  let review: NynaeveReview;
  try {
    const result = await nynaeve.generate(renderDecisionForReview(decision, facts), {
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
    await setDecisionVerdict(decisionId, "review_failed", reason, null);
    return { decisionId, verdict: "review_failed", reason, citations: [] };
  }

  const citations: AuthorityCitation[] = review.citations.map((c) => ({
    blockId: c.blockId,
    quote: c.quote,
  }));

  await setDecisionVerdict(
    decisionId,
    review.verdict,
    review.reason,
    citations.length > 0 ? citations : null,
  );

  return {
    decisionId,
    verdict: review.verdict,
    reason: review.reason,
    citations,
  };
}
