// Claude classification of AcroForm widgets — the AI-judgment half of the
// Phase C pipeline.
//
// Input: form metadata + AcroForm widgets (deterministic spine) + per-page
// rendered text. Output: one classification per widget — fieldId, human
// label, UI category, and valueType. Widgets that don't map to meaningful
// fields (decorative boxes, button widgets) can be marked `skip` so the
// downstream catalog drops them.
//
// The 1040 PDF surfaces ~200 widgets (every radio option + every checkbox
// counts), which doesn't fit in a single Sonnet structured-output turn.
// We batch widgets into groups of WIDGET_BATCH_SIZE per call. The form
// context (system prompt + rendered page text) is sent with
// `cache_control: ephemeral` so every batch after the first hits the
// prompt cache for the bulky inputs and only pays for the per-batch
// widget table + the per-batch response.
//
// Uses Anthropic's tool-use mode for structured output: define a tool with
// the desired schema, force a tool call, parse tool_use.input.

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedWidget } from "./extractAcroForm.js";
import type { FormPage } from "./extractFormText.js";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16000;
const WIDGET_BATCH_SIZE = 40;

export type Category =
  | "personal_info"
  | "filing_scope"
  | "income"
  | "deductions_credits"
  | "other";
export type ValueType = "numeric" | "single_select" | "text" | "boolean" | "date";

export interface ClassifiedField {
  /** Echo of the widget we asked about — joins back to ExtractedWidget. */
  pdfWidgetName: string;
  /** Synthesized fieldId, e.g. "form-1040.line.1a". */
  fieldId: string;
  label: string;
  category: Category;
  valueType: ValueType;
}

export interface ClassifiedSkip {
  pdfWidgetName: string;
  skipReason: string;
}

export interface ClassificationResult {
  fields: ClassifiedField[];
  skipped: ClassifiedSkip[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface ClassifyOpts {
  formId: string;
  taxYear: number;
  jurisdiction: string;
  formTitle: string;
  widgets: ExtractedWidget[];
  pages: FormPage[];
}

const SYSTEM_PROMPT = `You are classifying fillable form fields on a U.S. tax form into a structured catalog.

For each form field we give you, return one of:
  - A "field" entry — when the form field corresponds to a meaningful taxpayer-fillable thing (a line, a header field, a checkbox, a date cell, etc.).
  - A "skip" entry — when the form field is decorative, a UI helper, a separate button, or otherwise not a real catalog entry. Give a short reason.

Granularity is **per form field**. Every distinct fillable thing on the form gets its own entry — don't collapse multiple form fields into one logical entry. Example: on Form 1040, the AGI appears twice (line 11a on page 1, line 11b on page 2). Each is its own form field with its own fieldId. The tax for special forms (line 16: 4972 / 8814 checkboxes) is multiple form fields, one per checkbox. The home address breaks into separate street / apt / city / state / zip form fields.

Field IDs follow the convention "<formId>.<section>.<key>" where:
  - section names where the form field sits on the form (e.g. "header", "line", "signing")
  - key uniquely identifies the form field within that section (e.g. "first_name", "1a", "11a", "16_4972")

**Cross-batch consistency is critical.** When we send you a list of "fieldIds already assigned" from earlier batches, every fieldId you generate in this batch MUST either (a) be a completely new identifier not in that list, or (b) be omitted because the form field belongs to one of the existing entries. Don't invent synonyms — "header.address" and "header.address_street" referring to the same form field is a bug. Pick one canonical name on the first encounter and reuse it.

Examples for form-1040:
  - form field f1_14 → "form-1040.header.first_name", label "First name", category "personal_info", valueType "text"
  - form field c1_8[0] → "form-1040.header.filing_status_single", label "Filing status: Single", category "filing_scope", valueType "boolean"
  - form field f1_47 → "form-1040.line.1a", label "Total amount from Form(s) W-2, box 1", category "income", valueType "numeric"
  - form field f2_06 → "form-1040.line.15", label "Taxable income (line 11 − line 14, not less than 0)", category "income", valueType "numeric"

Categories (pick the closest fit — this is a loose UI bucket, not a precision call):
  - personal_info — taxpayer name, SSN, address, DOB; top-of-form header bits
  - filing_scope — filing status, residency, dependents counts, must-file selectors
  - income — wages, dividends, capital gains, taxable income, withholding (anything on the income side)
  - deductions_credits — standard deduction, QBI, tax, credits, payments, refund/owed
  - other — anything that doesn't fit cleanly

ValueTypes:
  - numeric — money amounts and counts
  - single_select — one-of-many choices
  - text — free-text strings (names, address segments)
  - boolean — yes/no or single checkbox
  - date — calendar dates

Use the page text alongside each form field to figure out the surrounding label. The form field's bounding box (x, y) and short name (e.g. "f1_47") tell you where it sits.`;

export async function classifyWidgets(
  opts: ClassifyOpts,
): Promise<ClassificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey });
  const formContext = buildFormContext(opts);

  const allFields: ClassifiedField[] = [];
  const allSkipped: ClassifiedSkip[] = [];
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  const batches: ExtractedWidget[][] = [];
  for (let i = 0; i < opts.widgets.length; i += WIDGET_BATCH_SIZE) {
    batches.push(opts.widgets.slice(i, i + WIDGET_BATCH_SIZE));
  }

  // Dedupe fieldIds across batches: first occurrence wins. We surface the
  // running list to each subsequent batch so the model reuses canonical
  // names instead of inventing synonyms ("header.address" vs.
  // "header.address_street") in isolation.
  const assignedFieldIds = new Map<string, string>(); // fieldId → label

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const widgetsTable = buildWidgetsTable(batch);
    const assignedTable = buildAssignedTable(assignedFieldIds);
    const userText = `Form: ${opts.formTitle} (${opts.formId}, tax year ${opts.taxYear}, jurisdiction ${opts.jurisdiction})

${assignedTable}

Batch ${i + 1} of ${batches.length} — ${batch.length} form fields to classify:
${widgetsTable}

Classify every form field into either a field or a skip entry. Return one entry per form field — same count as the table above. Reuse fieldIds from "Already-assigned fieldIds" above when a form field belongs to one of them; pick a new canonical fieldId otherwise.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: "classify_form_widgets",
          description:
            "Submit the classification for every widget in this batch. Field entries become rows in the form_fields catalog; skip entries are dropped.",
          input_schema: {
            type: "object",
            properties: {
              fields: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    pdf_widget_name: { type: "string" },
                    field_id: { type: "string" },
                    label: { type: "string" },
                    category: {
                      type: "string",
                      enum: [
                        "personal_info",
                        "filing_scope",
                        "income",
                        "deductions_credits",
                        "other",
                      ],
                    },
                    value_type: {
                      type: "string",
                      enum: ["numeric", "single_select", "text", "boolean", "date"],
                    },
                  },
                  required: [
                    "pdf_widget_name",
                    "field_id",
                    "label",
                    "category",
                    "value_type",
                  ],
                },
              },
              skipped: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    pdf_widget_name: { type: "string" },
                    skip_reason: { type: "string" },
                  },
                  required: ["pdf_widget_name", "skip_reason"],
                },
              },
            },
            required: ["fields", "skipped"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "classify_form_widgets" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: formContext,
              cache_control: { type: "ephemeral" },
            },
            {
              type: "text",
              text: userText,
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw new Error(
        `Batch ${i + 1}/${batches.length}: expected tool_use; got ${response.content
          .map((c) => c.type)
          .join(", ")}. stop_reason=${response.stop_reason}`,
      );
    }
    const rawInput = toolUse.input as
      | {
          fields?: Array<{
            pdf_widget_name: string;
            field_id: string;
            label: string;
            category: Category;
            value_type: ValueType;
          }>;
          skipped?: Array<{ pdf_widget_name: string; skip_reason: string }>;
        }
      | null;
    if (!rawInput || !Array.isArray(rawInput.fields)) {
      const preview = JSON.stringify(rawInput).slice(0, 500);
      throw new Error(
        `Batch ${i + 1}/${batches.length}: tool input malformed. ` +
          `stop_reason=${response.stop_reason}. Preview: ${preview}`,
      );
    }

    for (const f of rawInput.fields) {
      allFields.push({
        pdfWidgetName: f.pdf_widget_name,
        fieldId: f.field_id,
        label: f.label,
        category: f.category,
        valueType: f.value_type,
      });
      // Track on first occurrence; subsequent widgets pointing at the same
      // fieldId just reaffirm it (collisions are the intended outcome).
      if (!assignedFieldIds.has(f.field_id)) {
        assignedFieldIds.set(f.field_id, f.label);
      }
    }
    for (const s of rawInput.skipped ?? []) {
      allSkipped.push({
        pdfWidgetName: s.pdf_widget_name,
        skipReason: s.skip_reason,
      });
    }

    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_creation_input_tokens +=
      response.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

    console.log(
      `    batch ${i + 1}/${batches.length}: ${rawInput.fields.length} entries, ${(rawInput.skipped ?? []).length} skipped, ${assignedFieldIds.size} unique fieldIds so far (cache_read=${response.usage.cache_read_input_tokens ?? 0})`,
    );
  }

  return {
    fields: allFields,
    skipped: allSkipped,
    usage,
  };
}

function buildFormContext(opts: ClassifyOpts): string {
  const pageBlocks = opts.pages.map(
    (p) => `── Page ${p.page + 1} ──\n${p.text.trim()}`,
  );
  return `Form context (rendered page text):\n\n${pageBlocks.join("\n\n")}`;
}

function buildAssignedTable(assigned: Map<string, string>): string {
  if (assigned.size === 0) {
    return "Already-assigned fieldIds: (none — this is the first batch)";
  }
  const lines = ["Already-assigned fieldIds from earlier batches (reuse when applicable):"];
  for (const [id, label] of assigned) {
    lines.push(`  ${id} — ${label}`);
  }
  return lines.join("\n");
}

function buildWidgetsTable(widgets: ExtractedWidget[]): string {
  // Compact tab-separated table — name | short | kind | page | x | y.
  // Sort already done by extractAcroForm (top-to-bottom, left-to-right).
  const header = "pdf_widget_name\tshort\tkind\tpage\tx\ty";
  const rows = widgets.map((w) => {
    const x = w.position.x.toFixed(0);
    const y = w.position.y.toFixed(0);
    return `${w.fullName}\t${w.shortName}\t${w.kind}\tp${w.page + 1}\t${x}\t${y}`;
  });
  return [header, ...rows].join("\n");
}
