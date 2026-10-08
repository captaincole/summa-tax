// Phase D Mastra workflow: classify rule + params per form field, render
// the result as TypeScript, and overwrite the corresponding generated/
// file. Not registered with the production Mastra instance (PIPELINE.md
// keeps both forms-pipeline workflows standalone); invoked from
// scripts/formEngine/generateBindings.ts.

import { createWorkflow } from "@mastra/core/workflows";
import {
  workflowInputSchema,
  workflowOutputSchema,
  type WorkflowInput,
  type WorkflowOutput,
} from "./schemas.js";
import {
  prepareStep,
  retrieveStep,
  classifyStep,
  writeStep,
} from "./steps.js";

export const generateBindingsWorkflow = createWorkflow({
  id: "generate-bindings",
  inputSchema: workflowInputSchema,
  outputSchema: workflowOutputSchema,
})
  .then(prepareStep)
  .then(retrieveStep)
  .then(classifyStep)
  .then(writeStep)
  .commit();

export type { WorkflowInput, WorkflowOutput };

export async function runGenerateBindings(
  input: WorkflowInput,
): Promise<WorkflowOutput> {
  const run = await generateBindingsWorkflow.createRun();
  const result = await run.start({ inputData: input });
  if (result.status === "success") return result.result;
  if (result.status === "failed") throw result.error;
  throw new Error(
    `generate-bindings: unexpected workflow status '${result.status}'`,
  );
}
