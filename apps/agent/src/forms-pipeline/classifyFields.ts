// AI enrichment of extracted form fields.
//
// Upstream (extractFormFields.ts) now hands us the label deterministically
// from /TU or vision, so this stage no longer guesses labels from page text.
// Its remaining job is three semantic decisions per field:
//
//   - fieldId — stable "<formId>.<section>.<key>" id we can reference everywhere
//   - category — which Filing-Status panel bucket the field rolls up into
//   - valueType — what kind of value belongs in the field (money / count /
//                 text / ssn / phone / email / date / boolean / single_select /
//                 multi_select / signature)
//
// For radio groups we also assign stable snake_case keys to each option.
//
// The model is NOT responsible for:
//   - Discovering field structure (pdf.js told us)
//   - Inventing labels (extractFormFields tier-1/tier-2 produced them)
//   - Inventing option labels for radios (radioOptions[] is ground truth)

import Anthropic from "@anthropic-ai/sdk";
import type { ExtractedField } from "./extractFormFields.js";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16000;
const FIELDS_PER_BATCH = 40;

export type Category =
  | "personal_info"
  | "filing_scope"
  | "income"
  | "deductions_credits"
  | "other";

/**
 * Semantic value type. Coarser than the IRS schemas but rich enough to drive
 * the renderer's formatters and the engine's rule library without resorting
 * to label-pattern matching.
 *
 *   money         — dollar amount on a tax line (sum/subtract; format with separators)
 *   count         — small integer (number of dependents, exemptions); multiplied by tables
 *   text          — free text (name, address line)
 *   ssn           — 9-digit identifier; renderer strips/inserts dashes per widget maxLength
 *   phone         — phone number; renderer formats per widget maxLength
 *   zip           — ZIP code, 5 or 9 digits
 *   email         — email address; verbatim
 *   date          — calendar date; renderer formats per widget(s)
 *   boolean       — single checkbox flipped on/off
 *   single_select — radio group OR group of checkboxes where only one is valid
 *   multi_select  — independent checkboxes where any subset can be set
 *   signature     — signature field, not autofilled
 */
export type ValueType =
  | "money"
  | "count"
  | "text"
  | "ssn"
  | "phone"
  | "zip"
  | "email"
  | "date"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "signature";

export interface FieldEnrichmentOption {
  /** Stable identifier for this option (e.g. "single", "mfj"). */
  value: string;
  /** Echo of the deterministic option label so we can verify alignment. */
  radioOption: string;
}

export interface FieldEnrichment {
  pdfFieldName: string;
  fieldId: string;
  category: Category;
  valueType: ValueType;
  /** For radio groups: per-option stable values, same length as radioOptions[]. */
  options?: FieldEnrichmentOption[];
}

export interface FieldSkip {
  pdfFieldName: string;
  skipReason: string;
}

export interface ClassificationResult {
  enrichments: FieldEnrichment[];
  skipped: FieldSkip[];
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
  fields: ExtractedField[];
}

const SYSTEM_PROMPT = `You are assigning semantic metadata to PDF form fields on a U.S. tax form.

Each field arrives with its structure already known:
  - \`field_kind\` — text / checkbox / radio / signature / other (don't override)
  - \`label\` — the human-readable label, already resolved from /TU or vision (don't paraphrase)
  - For text fields: \`max_length\` and \`multiline\`
  - For radio groups: \`radio_options\` in PDF order (you'll assign stable values to each)

Your job is three decisions per field:

1. **field_id** — a stable "<formId>.<section>.<key>" identifier
   Sections: \`header\` (top-of-form personal info), \`line\` (numbered tax lines), \`signing\` (signature block), \`dependents\`, \`page2\`, etc.
   Use snake_case for the key. Pick a canonical name on first encounter; reuse it if a semantically-equivalent field appears later. The "Already-assigned fieldIds" table shows ids from earlier batches — reuse those when they fit.

2. **category** — which UI bucket the field rolls up into:
   \`personal_info\` / \`filing_scope\` / \`income\` / \`deductions_credits\` / \`other\`

3. **value_type** — what kind of value belongs in this field. Pick from:

   numeric variants (almost always text widgets):
     - \`money\` — dollar amount on a tax line ("Total amount from Form(s) W-2", "Adjusted gross income", "Tax")
     - \`count\` — small integer count ("Number of dependents", "Number of exemptions", "Personal: enter 1 or 2 in the box")

   text variants:
     - \`text\` — free text (first name, last name, address, occupation)
     - \`ssn\` — Social Security Number or ITIN (label mentions SSN/ITIN/identification number)
     - \`phone\` — phone number
     - \`zip\` — ZIP code (label mentions ZIP)
     - \`email\` — email address

   date variants:
     - \`date\` — calendar date (label mentions date / "Date of birth" / "born before…" with MM DD YYYY)

   selection variants:
     - \`boolean\` — a single checkbox (e.g. "Spouse itemizes on a separate return", "Filed pursuant to section 301.9100-2")
     - \`single_select\` — radio group OR group of mutually-exclusive checkboxes where only one is valid
     - \`multi_select\` — independent checkboxes where any subset can be set

   other:
     - \`signature\` — signature fields (kind = signature)

For radio fields (kind = radio), also return \`options\` — one entry per \`radio_option\` in the same order, with a snake_case \`value\` per option and the original \`radio_option\` text echoed back. value_type for radios is almost always \`single_select\`.

If a field is genuinely decorative or duplicate-with-no-purpose, emit a skip entry instead.

**Field-id conventions** (use these exact ids when applicable):
  - form-1040.header.first_name_mi, form-1040.header.last_name, form-1040.header.ssn
  - form-1040.header.spouse_first_name_mi, form-1040.header.spouse_last_name, form-1040.header.spouse_ssn
  - form-1040.header.home_address, form-1040.header.apartment, form-1040.header.city, form-1040.header.state, form-1040.header.zip
  - form-1040.header.filing_status_single, form-1040.header.filing_status_mfj, form-1040.header.filing_status_mfs, form-1040.header.filing_status_hoh, form-1040.header.filing_status_qss
  - form-1040.line.1a, form-1040.line.11b, form-1040.line.12e, form-1040.line.16, form-1040.line.34
  - form-1040.signing.taxpayer_occupation, form-1040.signing.taxpayer_email, form-1040.signing.taxpayer_phone
  - form-540.header.filing_status (radio group with options)`;

export async function classifyFields(
  opts: ClassifyOpts,
): Promise<ClassificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });

  const allEnrichments: FieldEnrichment[] = [];
  const allSkipped: FieldSkip[] = [];
  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  const batches: ExtractedField[][] = [];
  for (let i = 0; i < opts.fields.length; i += FIELDS_PER_BATCH) {
    batches.push(opts.fields.slice(i, i + FIELDS_PER_BATCH));
  }

  const assignedFieldIds = new Map<string, string>(); // fieldId → label

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const fieldsJson = JSON.stringify(
      batch.map((f) => ({
        pdf_field_name: f.fieldName,
        short_name: f.shortName,
        field_kind: f.fieldKind,
        label: f.label,
        ...(f.maxLength != null ? { max_length: f.maxLength } : {}),
        ...(f.multiline ? { multiline: true } : {}),
        ...(f.comb ? { comb: true } : {}),
        ...(f.radioOptions ? { radio_options: f.radioOptions } : {}),
        ...(f.checkboxOnValue ? { checkbox_on: f.checkboxOnValue } : {}),
      })),
      null,
      2,
    );

    const userText = `Form: ${opts.formTitle} (${opts.formId}, tax year ${opts.taxYear}, jurisdiction ${opts.jurisdiction})

${buildAssignedTable(assignedFieldIds)}

Batch ${i + 1} of ${batches.length} — ${batch.length} fields to enrich:

${fieldsJson}

For each field above, return one enrichment (or one skip). Reuse fieldIds from "Already-assigned fieldIds" when semantically equivalent.`;

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: "enrich_fields",
          description:
            "Submit semantic enrichment for every field in this batch. Field entries become catalog rows; skip entries are dropped from the catalog but preserved in the run record.",
          input_schema: {
            type: "object",
            properties: {
              enrichments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    pdf_field_name: { type: "string" },
                    field_id: { type: "string" },
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
                      enum: [
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
                      ],
                    },
                    options: {
                      type: "array",
                      description:
                        "Required when field_kind is radio. One entry per radio_option in the PDF, in the same order. value is a stable snake_case key; radio_option echoes the PDF's exact label so we can verify alignment.",
                      items: {
                        type: "object",
                        properties: {
                          value: { type: "string" },
                          radio_option: { type: "string" },
                        },
                        required: ["value", "radio_option"],
                      },
                    },
                  },
                  required: [
                    "pdf_field_name",
                    "field_id",
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
                    pdf_field_name: { type: "string" },
                    skip_reason: { type: "string" },
                  },
                  required: ["pdf_field_name", "skip_reason"],
                },
              },
            },
            required: ["enrichments", "skipped"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "enrich_fields" },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: userText }],
        },
      ],
    });

    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      console.warn(
        `[classify] batch ${i + 1}/${batches.length}: no tool_use returned (stop_reason=${response.stop_reason}); skipping batch`,
      );
      continue;
    }
    const rawInput = toolUse.input as
      | {
          enrichments?:
            | Array<{
                pdf_field_name: string;
                field_id: string;
                category: Category;
                value_type: ValueType;
                options?: Array<{ value: string; radio_option: string }>;
              }>
            | string;
          skipped?:
            | Array<{ pdf_field_name: string; skip_reason: string }>
            | string;
        }
      | null;
    if (rawInput && typeof rawInput.enrichments === "string") {
      try {
        rawInput.enrichments = JSON.parse(rawInput.enrichments);
      } catch {
        /* fall through */
      }
    }
    if (rawInput && typeof rawInput.skipped === "string") {
      try {
        const parsed = JSON.parse(rawInput.skipped);
        rawInput.skipped = Array.isArray(parsed) ? parsed : undefined;
      } catch {
        rawInput.skipped = undefined;
      }
    }
    if (!rawInput || !Array.isArray(rawInput.enrichments)) {
      console.warn(
        `[classify] batch ${i + 1}/${batches.length}: malformed tool input; skipping batch. Preview: ${JSON.stringify(rawInput).slice(0, 300)}`,
      );
      continue;
    }

    for (const f of rawInput.enrichments) {
      const enrichment: FieldEnrichment = {
        pdfFieldName: f.pdf_field_name,
        fieldId: f.field_id,
        category: f.category,
        valueType: f.value_type,
      };
      if (Array.isArray(f.options) && f.options.length > 0) {
        enrichment.options = f.options.map((o) => ({
          value: o.value,
          radioOption: o.radio_option,
        }));
      }
      allEnrichments.push(enrichment);
      if (!assignedFieldIds.has(f.field_id)) {
        const matched = batch.find((b) => b.fieldName === f.pdf_field_name);
        assignedFieldIds.set(f.field_id, matched?.label ?? "");
      }
    }
    const skippedArr = Array.isArray(rawInput.skipped) ? rawInput.skipped : [];
    for (const s of skippedArr) {
      allSkipped.push({
        pdfFieldName: s.pdf_field_name,
        skipReason: s.skip_reason,
      });
    }

    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_creation_input_tokens +=
      response.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

    console.log(
      `    batch ${i + 1}/${batches.length}: ${rawInput.enrichments.length} enriched, ${skippedArr.length} skipped, ${assignedFieldIds.size} unique fieldIds so far`,
    );
  }

  return { enrichments: allEnrichments, skipped: allSkipped, usage };
}

function buildAssignedTable(assigned: Map<string, string>): string {
  if (assigned.size === 0) {
    return "Already-assigned fieldIds: (none — this is the first batch)";
  }
  const lines = [
    "Already-assigned fieldIds from earlier batches (reuse when applicable):",
  ];
  for (const [id, label] of assigned) {
    lines.push(`  ${id} — ${label}`);
  }
  return lines.join("\n");
}
