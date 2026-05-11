// Zod schemas for the Phase C ingest workflow. Each step's outputSchema is
// the next step's inputSchema — we accumulate state via .extend() so the
// workflow never has to thread "optional fields filled in later" through.

import { z } from "zod";

// ─── Primitive shapes shared across steps ────────────────────────────────

const widgetSchema = z.object({
  fullName: z.string(),
  shortName: z.string(),
  kind: z.enum(["text", "checkbox", "radio", "other"]),
  page: z.number().int(),
  position: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
});

const pageSchema = z.object({
  page: z.number().int(),
  text: z.string(),
});

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

const classifiedFieldSchema = z.object({
  pdfWidgetName: z.string(),
  fieldId: z.string(),
  label: z.string(),
  category: categorySchema,
  valueType: valueTypeSchema,
});

const classifiedSkipSchema = z.object({
  pdfWidgetName: z.string(),
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
  widgets: z.array(widgetSchema),
  totalPages: z.number().int(),
  pages: z.array(pageSchema),
});

export const afterClassifySchema = afterExtractSchema.extend({
  classifiedFields: z.array(classifiedFieldSchema),
  skipped: z.array(classifiedSkipSchema),
  usage: usageSchema,
});

export const workflowOutputSchema = z.object({
  outputPath: z.string(),
  totalWidgets: z.number().int(),
  classifiedCount: z.number().int(),
  skippedCount: z.number().int(),
  uniqueFieldCount: z.number().int(),
  dbWritten: z.boolean(),
  usage: usageSchema,
  skipSample: z.array(classifiedSkipSchema),
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;
export type AfterExtract = z.infer<typeof afterExtractSchema>;
export type AfterClassify = z.infer<typeof afterClassifySchema>;
export type WorkflowOutput = z.infer<typeof workflowOutputSchema>;
