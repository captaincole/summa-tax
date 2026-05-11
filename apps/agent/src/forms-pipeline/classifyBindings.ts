// Phase D — per-field binding classification.
//
// For each form field in the catalog, pick a rule from our 7-rule library
// and emit its params. The output is a "binding" — the behavior layer of
// the form engine. Renders into forms/generated/<formId>.ts as
// bindField(...) calls.
//
// Batched at 10 fields per Claude call. The bulky context — rule-library
// spec, full field inventory, available facts/decisions schema — is sent
// as a cache-controlled content block, so every batch after the first
// hits the prompt cache and only pays for the per-batch field list + the
// tool response. Concurrency cap (3 in flight) smooths the TPM curve so
// long forms don't burst-fail rate limits.

import Anthropic from "@anthropic-ai/sdk";
import type { FieldInventory } from "../mastra/forms/catalog.js";
import type { RetrievedFieldContext } from "./retrieveContext.js";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16000;
const FIELDS_PER_BATCH = 10;
const CONCURRENCY = 3;

export type RuleName =
  | "lookupFact"
  | "sumFacts"
  | "tableLookupByDecision"
  | "lookupDecision"
  | "fromFields"
  | "constant"
  | "bracketLookup";

export interface ClassifiedBinding {
  fieldId: string;
  ruleName: RuleName;
  /** Rule-specific params. Validated against the rule's Zod schema downstream. */
  params: Record<string, unknown>;
  rationale: string;
}

export interface BindingClassificationResult {
  bindings: ClassifiedBinding[];
  mustFile: {
    decisionKey: string;
    rationale: string;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

export interface ClassifyBindingsOpts {
  formId: string;
  taxYear: number;
  jurisdiction: string;
  formTitle: string;
  fields: FieldInventory[];
  /** Optional per-field retrieved IRS-instruction blocks. When present,
   *  each batch's prompt embeds the relevant blocks alongside each field.
   *  When absent, the classifier runs purely on field-label heuristics. */
  retrievedContext?: RetrievedFieldContext[];
}

const RULE_LIBRARY_SPEC = `Rule library — pick one rule per field:

lookupFact — Read a single fact by key.
  params: { factKey: string }
  Use for header/identity fields and any 1-to-1 fact mapping.

sumFacts — Aggregate a numeric field across all facts in a category (optionally filtered by key prefix).
  params: { category: string, keyPrefix?: string, fieldPath: string }
  Use for sum-of-many-similar-facts (line 1a = sum of W-2 box 1, line 3a = sum of 1099-DIV box 1b).

lookupDecision — Pass through an ai_decision value as-is.
  params: { decisionKey: string }
  Use for single-select fields (filing status) and must-file bindings.

tableLookupByDecision — Look up a numeric value from a flat table keyed on a decision's value.
  params: { decisionKey: string, table: Record<string, number> }
  Use for filing-status-dependent constants: standard deduction, exemption amounts.

fromFields — Signed sum / reference of other fields (intra-form or cross-form).
  params: {
    terms: Array<{ formId: string, fieldId: string, sign: number (typically +1 or -1), whenSourceNotRequired?: number }>,
    floor?: number,
    rationale?: string,
  }
  Use for any line-arithmetic ("line 11 = line 9 − line 10", "line 7 = schedule-d.line.16"). For cross-form refs where the source form may not apply, set whenSourceNotRequired (typically 0).

constant — Fixed value, no inputs.
  params: { value: unknown, rationale: string }
  Use for fields with no available data source — placeholder that surfaces 0 until we ingest the relevant facts. Always provide a rationale explaining what's missing.

bracketLookup — Progressive tax bracket math.
  params: {
    decisionKey: string (typically "decisions.scope.filing_status"),
    inputFieldId: string (the taxable income field),
    brackets: Record<string, Array<{ upTo: number, rate: number }>>
  }
  Use ONLY for the tax-line calculation (1040 line 16). For other progressive math we'll add rules later.`;

const AVAILABLE_DATA_SPEC = `Available tax_facts (fact_key patterns):
  - identity.name.first, identity.name.last, identity.ssn, identity.dob, identity.address
  - wages, key "employer.{slug}" → { box1, box2, box3, …, box16, box17 } (one per W-2)
  - investment_income, key "account.{slug}.dividends" → { box1a, box1b, box2a, … } (one per 1099-DIV)
  - investment_income, key "account.{slug}.trade.{tradeId}" → { proceeds, costBasis, dateAcquired, dateSold, … }

Available ai_decisions (decision_key patterns):
  - decisions.scope.must_file_federal (boolean)
  - decisions.scope.filing_status (string: "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household" | "qualifying_surviving_spouse")
  - decisions.scope.has_reportable_sales (boolean)
  - decisions.trade.{tradeId}.form_8949_box (string)

For fields that don't map to any of the above (spouse info, dependents, retirement, foreign income, Schedule 1/2/3 detail, signing block, paid preparer block, …), bind to \`constant\` with value 0 and explain why in the rationale (e.g. "spouse fields not yet ingested" or "schedule 2 fields not yet wired"). The form will surface 0 for those lines until we extend ingestion.`;

const SYSTEM_PROMPT = `You are generating bindings for U.S. tax form fields. Each binding pairs a field with a rule from our library that determines how the form engine computes its value.

${RULE_LIBRARY_SPEC}

${AVAILABLE_DATA_SPEC}

Picking rules:
  - Identity / single-fact reads → lookupFact
  - Sum across many similar facts → sumFacts
  - Pass through a decision (filing status, residency selector) → lookupDecision
  - Filing-status-keyed constant (standard deduction) → tableLookupByDecision
  - Math over other lines → fromFields
  - Tax bracket math (only line 16) → bracketLookup
  - Anything not yet supported → constant 0 with a rationale

When using fromFields for intra-form math (e.g. line 11 = line 9 − line 10), every term's formId is the current form being bound. When using fromFields for cross-form refs (e.g. 1040 line 7 from schedule-d.line.16), use the source form's id and include whenSourceNotRequired: 0 if the source form might not apply.

Don't invent facts or decisions that aren't on the "Available" list. If a field requires data we don't have, use constant 0 with an explanatory rationale — that's the honest answer.

Rationales should be one short sentence per binding ("Sum of W-2 box 1 across employers"). The form engine surfaces rationales to debug why a value came out a certain way.`;

export async function classifyBindings(
  opts: ClassifyBindingsOpts,
  onBatchComplete?: (
    batchIndex: number,
    totalBatches: number,
    batchSize: number,
  ) => void,
): Promise<BindingClassificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey });

  // The full inventory is cached prefix context — every batch's prompt
  // references it the same way, so prompt caching pays off heavily.
  const inventoryBlock = buildInventoryBlock(opts);

  // Index retrieved context by fieldId so per-batch rendering is O(1).
  const contextByFieldId = new Map<string, RetrievedFieldContext>();
  for (const c of opts.retrievedContext ?? []) {
    contextByFieldId.set(c.fieldId, c);
  }

  // Slice fields into batches.
  const batches: FieldInventory[][] = [];
  for (let i = 0; i < opts.fields.length; i += FIELDS_PER_BATCH) {
    batches.push(opts.fields.slice(i, i + FIELDS_PER_BATCH));
  }

  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
  const allBindings: ClassifiedBinding[] = [];
  let mustFile: BindingClassificationResult["mustFile"] | null = null;

  // Concurrency-capped worker pool over batches.
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= batches.length) return;
      const batch = batches[i];
      const result = await classifyOneBatch(
        client,
        opts,
        inventoryBlock,
        batch,
        i,
        batches.length,
        contextByFieldId,
      );
      // Aggregate.
      for (const b of result.bindings) allBindings.push(b);
      if (result.mustFile && !mustFile) mustFile = result.mustFile;
      usage.input_tokens += result.usage.input_tokens;
      usage.output_tokens += result.usage.output_tokens;
      usage.cache_creation_input_tokens += result.usage.cache_creation_input_tokens;
      usage.cache_read_input_tokens += result.usage.cache_read_input_tokens;
      onBatchComplete?.(i, batches.length, batch.length);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()),
  );

  if (!mustFile) {
    throw new Error(
      "classifyBindings: no batch returned a mustFile binding — check the prompt + tool schema.",
    );
  }

  return {
    bindings: allBindings,
    mustFile,
    usage,
  };
}

interface SingleBatchResult {
  bindings: ClassifiedBinding[];
  mustFile: BindingClassificationResult["mustFile"] | null;
  usage: BindingClassificationResult["usage"];
}

async function classifyOneBatch(
  client: Anthropic,
  opts: ClassifyBindingsOpts,
  inventoryBlock: string,
  batch: FieldInventory[],
  batchIndex: number,
  totalBatches: number,
  contextByFieldId: Map<string, RetrievedFieldContext>,
): Promise<SingleBatchResult> {
  const fieldsTable = batch
    .map((f, i) => renderFieldEntry(i + 1, f, contextByFieldId.get(f.fieldId)))
    .join("\n\n");

  const userText = `Form: ${opts.formTitle} (${opts.formId}, tax year ${opts.taxYear}, jurisdiction ${opts.jurisdiction})

Batch ${batchIndex + 1} of ${totalBatches} — bind these ${batch.length} field(s):
${fieldsTable}

For each field, emit a binding via the emit_bindings tool. ${batchIndex === 0 ? "Also include the must-file binding for this form (the decisionKey that determines whether the form is filed at all)." : "The must-file binding has already been recorded in an earlier batch — omit it here."}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "emit_bindings",
        description:
          "Submit the bindings for the form fields in this batch. Each binding pairs a fieldId with a ruleName and the rule's params.",
        input_schema: {
          type: "object",
          properties: {
            bindings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  field_id: { type: "string" },
                  rule_name: {
                    type: "string",
                    enum: [
                      "lookupFact",
                      "sumFacts",
                      "tableLookupByDecision",
                      "lookupDecision",
                      "fromFields",
                      "constant",
                      "bracketLookup",
                    ],
                  },
                  params: {
                    type: "object",
                    description:
                      "Rule-specific params. Shape depends on rule_name — see system prompt.",
                  },
                  rationale: { type: "string" },
                },
                required: ["field_id", "rule_name", "params", "rationale"],
              },
            },
            must_file: {
              type: "object",
              description:
                "ONLY included on the first batch. The decisionKey whose value determines whether this form must be filed.",
              properties: {
                decision_key: { type: "string" },
                rationale: { type: "string" },
              },
              required: ["decision_key", "rationale"],
            },
          },
          required: ["bindings"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "emit_bindings" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: inventoryBlock,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `Batch ${batchIndex + 1}/${totalBatches}: no tool_use; stop_reason=${response.stop_reason}`,
    );
  }
  const raw = toolUse.input as {
    bindings?: Array<{
      field_id: string;
      rule_name: RuleName;
      params: Record<string, unknown>;
      rationale: string;
    }>;
    must_file?: { decision_key: string; rationale: string };
  };

  if (!raw?.bindings || !Array.isArray(raw.bindings)) {
    throw new Error(
      `Batch ${batchIndex + 1}/${totalBatches}: tool input missing bindings array. stop_reason=${response.stop_reason}.`,
    );
  }

  return {
    bindings: raw.bindings.map((b) => ({
      fieldId: b.field_id,
      ruleName: b.rule_name,
      params: b.params,
      rationale: b.rationale,
    })),
    mustFile: raw.must_file
      ? {
          decisionKey: raw.must_file.decision_key,
          rationale: raw.must_file.rationale,
        }
      : null,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens:
        response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}

// One per-batch field entry: field metadata + the retrieved IRS blocks
// for that field (when retrieval was run). Blocks are trimmed to a
// manageable length so a 10-field batch doesn't blow past the per-batch
// uncached token budget.
const MAX_BLOCK_CHARS = 800;
function renderFieldEntry(
  ordinal: number,
  field: FieldInventory,
  context: RetrievedFieldContext | undefined,
): string {
  const header = `${ordinal}. ${field.fieldId} — "${field.label}" (category=${field.category}, valueType=${field.valueType})`;
  if (!context || context.blocks.length === 0) return header;
  const blockLines = context.blocks
    .map((b) => {
      const text = b.text.replace(/\s+/g, " ").trim();
      const trimmed =
        text.length > MAX_BLOCK_CHARS
          ? text.slice(0, MAX_BLOCK_CHARS) + "…"
          : text;
      return `     [${b.blockId}] ${trimmed}`;
    })
    .join("\n");
  return `${header}\n   IRS context:\n${blockLines}`;
}

// Renders the full field inventory as a cached prefix block. Lets each
// batch reference any field (for fromFields cross-references) while only
// paying the prefix tokens once.
function buildInventoryBlock(opts: ClassifyBindingsOpts): string {
  const lines = opts.fields.map(
    (f) =>
      `  ${f.fieldId} — "${f.label}" (category=${f.category}, valueType=${f.valueType})`,
  );
  return `Form being bound: ${opts.formTitle} (${opts.formId}, tax year ${opts.taxYear})

Full field inventory (${opts.fields.length} fields — use for cross-field references via fromFields):
${lines.join("\n")}`;
}
