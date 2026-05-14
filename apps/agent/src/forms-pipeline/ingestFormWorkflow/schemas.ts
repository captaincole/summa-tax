// Zod schemas for the form-ingest workflow. Each step's outputSchema is the
// next step's inputSchema — we accumulate state via .extend() so the workflow
// never has to thread "optional fields filled in later" through.

import { z } from "zod";

// ─── Primitive shapes shared across steps ────────────────────────────────

const fieldKindSchema = z.enum([
  "text",
  "checkbox",
  "radio",
  "signature",
  "other",
]);

const labelSourceSchema = z.enum(["tu", "vision"]);

const fieldWidgetSchema = z.object({
  page: z.number().int(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  buttonValue: z.string().optional(),
});

const extractedFieldSchema = z.object({
  fieldName: z.string(),
  shortName: z.string(),
  fieldKind: fieldKindSchema,
  label: z.string(),
  labelSource: labelSourceSchema,
  maxLength: z.number().int().nullable().optional(),
  multiline: z.boolean().optional(),
  comb: z.boolean().optional(),
  radioOptions: z.array(z.string()).optional(),
  checkboxOnValue: z.string().optional(),
  widgets: z.array(fieldWidgetSchema),
});

const categorySchema = z.enum([
  "personal_info",
  "filing_scope",
  "income",
  "deductions_credits",
  "other",
]);

const valueTypeSchema = z.enum([
  "money",
  "count",
  "text",
  "ssn",
  "phone",
  "zip",
  "email",
  "date",
  "boolean",
  "single_select",
  "multi_select",
  "signature",
]);

const enrichmentOptionSchema = z.object({
  value: z.string(),
  radioOption: z.string(),
});

const fieldEnrichmentSchema = z.object({
  pdfFieldName: z.string(),
  fieldId: z.string(),
  category: categorySchema,
  valueType: valueTypeSchema,
  options: z.array(enrichmentOptionSchema).optional(),
});

const fieldSkipSchema = z.object({
  pdfFieldName: z.string(),
  skipReason: z.string(),
});

const usageSchema = z.object({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_creation_input_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int(),
});

// ─── Step-by-step schemas ────────────────────────────────────────────────

export const workflowInputSchema = z.object({
  pdfPath: z.string(),
  formId: z.string(),
  taxYear: z.number().int(),
  jurisdiction: z.string(),
  formTitle: z.string(),
  outputPath: z.string(),
  writeDb: z.boolean(),
});

export const afterExtractSchema = workflowInputSchema.extend({
  fields: z.array(extractedFieldSchema),
  totalPages: z.number().int(),
});

export const afterClassifySchema = afterExtractSchema.extend({
  enrichments: z.array(fieldEnrichmentSchema),
  skipped: z.array(fieldSkipSchema),
  usage: usageSchema,
});

export const workflowOutputSchema = z.object({
  outputPath: z.string(),
  totalFields: z.number().int(),
  enrichedCount: z.number().int(),
  unenrichedCount: z.number().int(),
  skippedCount: z.number().int(),
  catalogEntryCount: z.number().int(),
  dbWritten: z.boolean(),
  usage: usageSchema,
  skipSample: z.array(fieldSkipSchema),
  /** pdfFieldNames that had no enrichment and got a placeholder fieldId. */
  unenrichedSample: z.array(z.string()),
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type AfterExtract = z.infer<typeof afterExtractSchema>;
export type AfterClassify = z.infer<typeof afterClassifySchema>;
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
