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
  "fromFields",
  "constant",
  "bracketLookup",
  "unsupported",
]);

const classifiedBindingSchema = z.object({
  fieldId: z.string(),
  ruleName: ruleNameSchema,
  params: z.record(z.string(), z.unknown()),
  rationale: z.string(),
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
  /** Path to the JSON catalog fixture (e.g. fixtures/forms/form-1040-2025.extracted.json). */
  catalogPath: z.string(),
  /** Where to write the generated TS — e.g. src/mastra/forms/generated/form-1040.ts. */
  outputPath: z.string(),
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
  bindingsCount: z.number().int(),
  unboundCount: z.number().int(),
  ruleBreakdown: z.record(z.string(), z.number().int()),
  retrievalCount: z.number().int(),
  usage: usageSchema,
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type AfterPrepare = z.infer<typeof afterPrepareSchema>;
export type AfterRetrieve = z.infer<typeof afterRetrieveSchema>;
export type AfterClassify = z.infer<typeof afterClassifySchema>;
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
