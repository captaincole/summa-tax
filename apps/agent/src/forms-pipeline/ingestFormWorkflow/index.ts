// Phase C Mastra workflow: ingest a form PDF into the form_fields catalog.
//
// Not registered with the production Mastra instance (per PIPELINE.md the
// forms-pipeline workflows run standalone from CLI scripts). Mastra's
// in-memory storage handles snapshots for the duration of the run; we
// don't persist them across invocations.

import { createWorkflow } from "@mastra/core/workflows";
import {
  workflowInputSchema,
  workflowOutputSchema,
  type WorkflowInput,
  type WorkflowOutput,
} from "./schemas.js";
import { extractStep, classifyStep, persistStep } from "./steps.js";

export const ingestFormWorkflow = createWorkflow({
  id: "ingest-form",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(extractStep)
  .then(classifyStep)
  .then(persistStep)
  .commit();

export type { WorkflowInput, WorkflowOutput };

/**
 * Run the workflow end-to-end. Thin wrapper around createRun/start that
 * unwraps the success result or throws on failure. Used by
 * scripts/ingestForm.ts.
 */
export async function runIngestForm(input: WorkflowInput): Promise<WorkflowOutput> {
  const run = await ingestFormWorkflow.createRun();
  const result = await run.start({ inputData: input });
  if (result.status === "success") {
    return result.result;
  }
  if (result.status === "failed") {
    throw result.error;
  }
  throw new Error(
    `ingest-form: unexpected workflow status '${result.status}'`,
  );
}
