import { createWorkflow } from "@mastra/core/workflows";
import {
  RequestContext,
  MASTRA_RESOURCE_ID_KEY,
} from "@mastra/core/request-context";
import { z } from "zod";
import {
  loopCarrierSchema,
  reviewDecisionOutputSchema,
  type ReviewDecisionOutput,
} from "./schemas";
import {
  initStep,
  gatherStep,
  assessRiskStep,
  ruleStep,
  finalizeStep,
} from "./steps";
import {
  completeReviewRun,
} from "../../db/reviewRuns";
import { setDecisionVerdict } from "../../db/aiDecisions";
import type { Scope } from "../../db/appDb";

// ---------------------------------------------------------------------------
// Loop body — gather → assess → rule. Wrapped as a child workflow so the
// parent can `.dountil()` it. Each iteration's input is the previous
// iteration's output (LoopCarrier in, LoopCarrier out).
// ---------------------------------------------------------------------------

export const reviewLoopWorkflow = createWorkflow({
  id: "review-decision-loop",
  inputSchema: loopCarrierSchema,
  outputSchema: loopCarrierSchema,
})
  .then(gatherStep)
  .then(assessRiskStep)
  .then(ruleStep)
  .commit();

// ---------------------------------------------------------------------------
// Parent workflow — init → loop (max 3 iterations) → finalize.
// ---------------------------------------------------------------------------

export const reviewDecisionWorkflow = createWorkflow({
  id: "review-decision",
  inputSchema: z.object({ decisionId: z.string() }),
  outputSchema: reviewDecisionOutputSchema,
})
  .then(initStep)
  .dountil(reviewLoopWorkflow, async ({ inputData, iterationCount }) => {
    // Stop when rule committed to a verdict OR we've burned 3 iterations.
    // ruleStep bumps `iteration` to N+1 only when it returned need_more, so
    // checking `iterationCount` against 3 (Mastra-supplied count) is the
    // canonical hard stop.
    return inputData.ruleOutput?.kind === "verdict" || iterationCount >= 3;
  })
  .then(finalizeStep)
  .commit();

// ---------------------------------------------------------------------------
// Public wrapper. Runs the workflow and returns the terminal output. Wraps
// errors so a failed review row gets marked 'failed' on the way out — Luca
// always sees a definitive state for every record-ai-decision call.
// ---------------------------------------------------------------------------

export type { ReviewDecisionOutput };

export async function reviewDecision(
  scope: Scope,
  decisionId: string,
): Promise<ReviewDecisionOutput> {
  const requestContext = new RequestContext();
  requestContext.set(MASTRA_RESOURCE_ID_KEY, scope.userId);

  const run = await reviewDecisionWorkflow.createRun({
    resourceId: scope.userId,
  });

  try {
    const result = await run.start({
      inputData: { decisionId },
      requestContext,
    });
    if (result.status === "success") {
      return result.result;
    }
    if (result.status === "failed") {
      throw result.error;
    }
    throw new Error(
      `review-decision: unexpected workflow status '${result.status}'`,
    );
  } catch (err) {
    // Best-effort failure recording: stamp the decision row + the review_runs
    // row so Luca (and the trace log) see why this fell over. We don't have
    // the reviewRunId reliably here (init may have failed), so we only stamp
    // the ai_decisions row in that case.
    const reason = err instanceof Error ? err.message : String(err);
    try {
      await setDecisionVerdict(
        scope,
        decisionId,
        "review_failed",
        reason,
        null,
      );
    } catch {
      /* swallow — the original error is what matters */
    }
    // If init succeeded and we have a recent run, mark it failed too. Best
    // effort; not all error paths give us the runId.
    const runId = (err as { reviewRunId?: string }).reviewRunId;
    if (runId) {
      try {
        await completeReviewRun(scope, {
          id: runId,
          status: "failed",
          finalVerdict: "review_failed",
          iterationCount: 0,
          durationMs: 0,
          error: reason,
        });
      } catch {
        /* swallow */
      }
    }
    return {
      decisionId,
      reviewRunId: runId ?? "",
      iterationCount: 1,
      riskTier: null,
      finalVerdict: "review_failed",
      reason,
      citations: [],
    };
  }
}
