// Phase D workflow carriers. Each step's outputSchema is the next step's
// inputSchema; the carrier accumulates via .extend() so we never have to
// thread "optional fields filled in later."

import { z } from "zod";

const categorySchema = z.enum([
  "personal_info",
  "filing_scope",
  "income",
  "deductions_credits",
  "other",
]);
const valueTypeSchema = z.enum([
  "numeric",
  "single_select",
  "multi_select",
  "text",
  "boolean",
  "date",
]);

const fieldInventorySchema = z.object({
  fieldId: z.string(),
  formId: z.string(),
  label: z.string(),
  category: categorySchema,
  valueType: valueTypeSchema,
  pdfWidgetName: z.string().optional(),
  position: z
    .object({
      page: z.number().int(),
      x: z.number(),
      y: z.number(),
    })
    .optional(),
  ordinal: z.number().int(),
});

const ruleNameSchema = z.enum([
  "lookupFact",
  "sumFacts",
  "tableLookupByDecision",
  "lookupDecision",
  "decisionIfEquals",
  "fromFields",
  "constant",
  "bracketLookup",
  "taxTable",
  "unsupported",
]);

const confidenceSchema = z.enum(["high", "medium", "low"]);

const classifiedBindingSchema = z.object({
  fieldId: z.string(),
  ruleName: ruleNameSchema,
  params: z.record(z.string(), z.unknown()),
  rationale: z.string(),
  /**
   * Self-rated confidence in this binding:
   *   high   — label + data path are both unambiguous; bind directly.
   *   medium — label is clear but I'm guessing about which fact/slot to use.
   *   low    — label is ambiguous OR I picked unsupported because no path fits.
   * The renderer routes low/medium below `minConfidence` to a TODO map so a
   * human reviews them.
   */
  confidence: confidenceSchema,
});

const retrievedBlockSchema = z.object({
  blockId: z.string(),
  docId: z.string(),
  text: z.string(),
  score: z.number().optional(),
});

const retrievedContextSchema = z.object({
  fieldId: z.string(),
  blocks: z.array(retrievedBlockSchema),
});

const usageSchema = z.object({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_creation_input_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int(),
});

// ─── Step schemas ────────────────────────────────────────────────────────

export const workflowInputSchema = z.object({
  formId: z.string(),
  taxYear: z.number().int(),
  /** Path to the JSON catalog (e.g. ref/forms/form-1040-2025.catalog.json). */
  catalogPath: z.string(),
  /**
   * Where to write the generated TS — e.g.
   * src/mastra/forms/federal/1040/bindings.ts.
   */
  outputPath: z.string(),
  /**
   * Minimum confidence to emit a binding. Anything below this threshold
   * goes to the `todos` map for human review instead of into `bindings`.
   * Default "high" — strict; lower it to ingest more bindings at the cost
   * of needing fewer human revisits.
   */
  minConfidence: confidenceSchema.default("high"),
});

export const afterPrepareSchema = workflowInputSchema.extend({
  jurisdiction: z.string(),
  formTitle: z.string(),
  fields: z.array(fieldInventorySchema),
});

export const afterRetrieveSchema = afterPrepareSchema.extend({
  retrievedContext: z.array(retrievedContextSchema),
});

export const afterClassifySchema = afterRetrieveSchema.extend({
  bindings: z.array(classifiedBindingSchema),
  mustFile: z.object({
    decisionKey: z.string(),
    rationale: z.string(),
  }),
  usage: usageSchema,
});

export const workflowOutputSchema = z.object({
  outputPath: z.string(),
  fieldCount: z.number().int(),
  /** Bindings the renderer wrote into the `bindings` map (confidence ≥ floor). */
  emittedCount: z.number().int(),
  /** Bindings the renderer pushed to `todos` (confidence < floor). */
  todoCount: z.number().int(),
  /** Bindings the renderer pushed to `unsupported`. */
  unsupportedCount: z.number().int(),
  /** Fields that had no AI binding at all (counted separately from todos). */
  unboundCount: z.number().int(),
  ruleBreakdown: z.record(z.string(), z.number().int()),
  confidenceBreakdown: z.record(z.string(), z.number().int()),
  retrievalCount: z.number().int(),
  usage: usageSchema,
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type AfterPrepare = z.infer<typeof afterPrepareSchema>;
export type AfterRetrieve = z.infer<typeof afterRetrieveSchema>;
export type AfterClassify = z.infer<typeof afterClassifySchema>;
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
