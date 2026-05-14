// Phase D — per-field binding classification.
//
// For each form field in the catalog, pick a rule from our library and
// emit its params + a self-rated confidence. The classifier's structured
// output gets translated by renderBindings into typed defineForm-shape
// TypeScript at the form's bindings.ts file. Low-confidence entries
// route to a `todos` map for human review.
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
import {
  loadCatalogIndex,
  formatIndexedForm,
  type CatalogIndex,
} from "./catalogIndex.js";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 16000;
const FIELDS_PER_BATCH = 10;
const CONCURRENCY = 3;
// Cap how many lookup_form_fields calls the classifier can make per batch
// before we force it to commit to a final emit_bindings. Protects against
// runaway loops if the model gets confused. In practice 1-2 lookups per
// batch is the realistic ceiling.
const MAX_LOOKUPS_PER_BATCH = 5;

export type RuleName =
  | "lookupFact"
  | "sumFacts"
  | "tableLookupByDecision"
  | "lookupDecision"
  | "decisionIfEquals"
  | "fromFields"
  | "constant"
  | "bracketLookup"
  | "taxTable"
  | "unsupported";

export type Confidence = "high" | "medium" | "low";

export interface ClassifiedBinding {
  fieldId: string;
  ruleName: RuleName;
  /** Rule-specific params. Validated against the rule's Zod schema downstream. */
  params: Record<string, unknown>;
  rationale: string;
  /**
   * Self-rated confidence in this binding.
   *   high   — label + data path are both unambiguous; bind directly.
   *   medium — label is clear but I'm guessing about which fact/slot to use.
   *   low    — label is ambiguous OR I picked `unsupported` because no path fits.
   * The renderer routes anything below the workflow's minConfidence floor to
   * a `todos` map (with rationale) so a human reviews them before the binding
   * ships.
   */
  confidence: Confidence;
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
  params: { factKey: string, optional?: boolean }
  Use for header/identity fields and any 1-to-1 fact mapping. Pass optional=true for sub-facts that the user often won't have (e.g. identity.address.apt) — missing optional facts return "" instead of blocking so Thom doesn't ask the user.

sumFacts — Aggregate a numeric field across all facts in a category (optionally filtered by key prefix).
  params: { category: string, keyPrefix?: string, fieldPath: string }
  Use for sum-of-many-similar-facts.
  IMPORTANT: \`fieldPath\` is a dot-path into the fact's VALUE object — it does NOT include the key suffix. For 1099-DIV facts keyed "account.{slug}.dividends" the value is { box1a, box1b, … } so fieldPath is "box1b", NOT "dividends.box1b". For W-2 facts keyed "employer.{slug}" the value is { box1, box2, … } so fieldPath is "box1", NOT "wages.box1".
  Examples:
    - line 1a (W-2 wages): { category: "wages", keyPrefix: "employer.", fieldPath: "box1" }
    - line 3a (qualified divs): { category: "investment_income", keyPrefix: "account.", fieldPath: "box1b" }
    - line 25a (W-2 withholding): { category: "wages", keyPrefix: "employer.", fieldPath: "box2" }

lookupDecision — Pass through an ai_decision value as-is.
  params: { decisionKey: string }
  Use for single-select fields and must-file bindings — NOT for radio groups (use decisionIfEquals + multi_select for those).

decisionIfEquals — Decision-driven binding. Two modes:
  params: { decisionKey: string, matchValue?: string }

  Mode 1 — Multi_select (default — no matchValue param):
    Use on catalog form fields whose valueType is "multi_select" or "single_select" (radio groups). The catalog declares the option set + per-option metadata. Rule returns the subset of option values matching the decision (typically 0 or 1).
    Example: filing_status form field (radio group) with options [single, mfj, mfs, hoh, qss] + decisionKey "decisions.scope.filing_status" → engine returns ["single"] when the decision is "single", renderer selects that option.

  Mode 2 — Per-checkbox boolean (with matchValue):
    Use when a form has N INDEPENDENT checkbox fields driven by the same decision — common on Form 1040 where the 5 filing-status options are 5 separate checkbox widgets, NOT a single radio group. Bind each checkbox separately with its own matchValue. Returns boolean true when decision === matchValue, false otherwise; renderer checks the box on true.
    Example: form-1040.header.filing_status_single → { decisionKey: "decisions.scope.filing_status", matchValue: "single" }
             form-1040.header.filing_status_mfj    → { decisionKey: "decisions.scope.filing_status", matchValue: "married_filing_jointly" }
    Tell mode 1 from mode 2 by the catalog: ONE multi_select field with options[] → mode 1. N separate boolean checkbox fields → mode 2.

tableLookupByDecision — Look up a numeric value from a flat table keyed on a decision's value.
  params: { decisionKey: string, table: Record<string, number> }
  Use for filing-status-dependent constants: standard deduction, exemption amounts.

fromFields — Signed sum / reference of other form fields (intra-form or cross-form).
  params: {
    terms: Array<{
      fieldId: string,   // FULL fieldId from the inventory (e.g. "form-1040.line.9", NOT "line.9").
                         // The source form is derived from the first segment.
      sign: number,      // Typically +1 or -1.
      whenSourceNotRequired?: number,  // Fallback if the source form isn't required (set to 0 on cross-form refs).
    }>,
    floor?: number,
    rationale?: string,
  }
  Use for any line-arithmetic ("line 11 = line 9 − line 10") or cross-form value references.

  IMPORTANT — **fromFields is robust to partial inputs.** The rule treats terms whose source is unsupported as 0, and terms whose source is \`blocked\` propagate the block. Two corollaries:
    1. **Build the sum with whatever terms exist.** When the form says "add lines 7 through 10" and lines 8/9 are bound to \`unsupported\` (or some lines' fieldIds don't appear in the inventory at all), still bind the parent line with the AVAILABLE terms. Don't bind the parent to \`unsupported\` just because some children are — the engine will sum the supported terms and treat the rest as 0. Example: line 11 = fromFields([line 7, line 10]) is correct even when lines 8/9 fieldIds don't exist; the engine produces line 7 + line 10 + 0 + 0.
    2. **Only bind the parent line \`unsupported\` when ZERO of its component fieldIds exist in the inventory.** If even one term's fieldId is in the inventory, bind fromFields with just that term — anyone reading the rendered form will see the partial sum, which is what they expect when the upstream lines are blank.

  Every term's fieldId MUST match an inventory entry EXACTLY — but for cross-form refs use \`lookup_form_fields\` first. Do not invent fieldIds; if a referenced form isn't in the inventory roster and has no fieldId you can confirm, omit that term entirely rather than guessing.

constant — Fixed value, no inputs.
  params: { value: unknown, rationale: string }
  Use ONLY for genuinely fixed values that are known regardless of taxpayer (e.g. tax year ending date = "12/31/2025"). DO NOT use for placeholders — prefer \`unsupported\` for those.

bracketLookup — Progressive tax bracket math.
  params: {
    decisionKey: string (typically "decisions.scope.filing_status"),
    inputFieldId: string (the taxable income field),
    brackets: Record<string, Array<{ upTo: number, rate: number }>>
  }
  RARELY USED. The IRS instructions require the Tax Table for sub-$100k income on 1040 line 16 (per-row tax computed at $50-bracket midpoint, NOT raw bracket math). Use \`taxTable\` for line 16. Reserve \`bracketLookup\` for future cases like AMT or the Tax Computation Worksheet (≥$100k income) once those paths are built.

taxTable — Tax-table lookup for any jurisdiction (federal 1040 line 16, CA 540 line 31, future state forms).
  params: {
    decisionKey: string (typically "decisions.scope.filing_status"),
    inputFieldId: string (the taxable income field, e.g. "form-1040.line.15" or "form-540.line.19_taxable_income"),
    tableId?: string (defaults to "federal-2025"; for CA 540 use "ca-2025"; future tableIds follow "<jurisdiction>-<year>")
  }
  Use for any "tax = <table>(taxable_income, filing_status)" line. The rule reads the per-jurisdiction table loaded by the engine (federal-2025, ca-2025, …) and returns the correct tax. Returns \`unsupported\` for income above the table ceiling (~$100k for both federal and CA). Handles all five filing statuses; QSS uses MFJ column per IRS/FTB instructions.
  CRITICAL: state forms (jurisdiction = "state-ca", "state-ny", …) MUST pass tableId="<state>-<year>". Omitting tableId on a state form would silently use the federal table — wrong answer.

unsupported — Mark a field as a known engine gap. We don't compute it yet because we don't have a worked example scenario or fact-ingestion path for it.
  params: { reason: string }
  Use for ANY field where we don't have an obvious mapping to facts or decisions yet. Examples: deceased-taxpayer date of death (no scenario yet), dependents detail (no dependent ingestion), spouse info (no MFJ scenario), foreign address, paid preparer block, signing-block dates.
  IMPORTANT: prefer \`unsupported\` over \`constant 0\` whenever the field's value depends on facts we haven't built ingestion for. \`constant\` is for fixed values; \`unsupported\` is for "we'll model this when a real scenario forces it." Downstream sums treat unsupported terms as 0 so the form still renders.`;

const AVAILABLE_DATA_SPEC = `Available tax_facts (fact_key patterns):
  Identity (category "identity"):
    - identity.name.first, identity.name.last, identity.ssn, identity.dob
    - identity.address.street, identity.address.apt (optional), identity.address.city,
      identity.address.state, identity.address.zip
    - identity.address.county (CA 540 header asks for this — Alex example: "Alameda")
    - identity.email     (Thom signs in via Supabase auth; auto-populated at doc-gen time; use with optional=true)
    - identity.phone     (Thom asks during intake; format "703-953-0253")
    - identity.occupation (Thom asks during intake; free-text like "Engineer")
  Wages (category "wages"):
    - key "employer.{slug}" → { box1, box2, box3, …, box14, box15, box16, box17 } (one per W-2)
      box15 is the state abbreviation ("CA"); box16 is state wages; box17 is state income tax withheld
  Investment income (category "investment_income"):
    - key "account.{slug}.dividends" → { box1a, box1b, box2a, … } (one per 1099-DIV)
    - key "account.{slug}.trade.{tradeId}" → { proceeds, costBasis, dateAcquired, dateSold, … }
  Health coverage (category "health_coverage"):
    - health_coverage.full_year_mec (boolean) — true when taxpayer had minimum essential coverage every month of the year. CA 540 line 92 reads this directly via lookupFact.
  Use tax (category "use_tax"):
    - use_tax.owed_amount (numeric) — taxpayer's self-reported use tax owed (CA-specific; usually 0). CA 540 line 91 reads this directly via lookupFact.

Available ai_decisions (decision_key patterns):
  - decisions.scope.must_file_federal (boolean) — used by form-1040's must-file binding
  - decisions.scope.must_file_ca_540 (boolean) — used by form-540's must-file binding
  - decisions.scope.filing_status (string: "single" | "married_filing_jointly" | "married_filing_separately" | "head_of_household" | "qualifying_surviving_spouse") — CANONICAL filing status used by BOTH federal and state forms. Don't invent a state-specific filing-status decision; CA 540 reuses the federal one.
  - decisions.scope.ca_residency (string: "full_year" | "part_year" | "non_resident") — drives state-form scoping; MVP only supports "full_year"
  - decisions.scope.mailing_same_as_principal_residence (boolean) — CA 540 header has a checkbox "Address above is the same as principal/physical residence." Bind that checkbox with decisionIfEquals(matchValue=true) for a boolean field, or read directly via lookupDecision.
  - decisions.scope.use_tax_zero_reason (string: "no_use_tax_owed" | "paid_directly_to_cdtfa") — CA 540 line 91 has a "If line 91 is zero, why?" radio group. Bind the radio group with decisionIfEquals (mode 1) — the catalog options expose the two values directly.
  - decisions.scope.has_reportable_sales (boolean) — set automatically by 1099 ingest
  - decisions.trade.{tradeId}.form_8949_box (string) — per-trade Form 8949 box assignment

For fields that don't map to any of the above (spouse info, dependents, retirement, foreign income, Schedule 1/2/3 detail, signing-block dates, paid preparer block, …), bind to \`unsupported\` with a reason explaining what scenario we'd need to support it (e.g. "no MFJ scenario yet — spouse fields unsupported" or "no dependent-with-CTC scenario yet"). The engine will treat these as gaps without surfacing them as user questions; downstream sums skip them as 0.

IMPORTANT — anti-hallucination: do NOT bind a field to a fact key whose semantics don't match the field. Example failure: binding header.middle_initial (maxLength=1) to identity.name.first (e.g. "Alex") — the renderer truncates and writes garbage. When no fact matches a field cleanly, bind to \`unsupported\`.`;

const SYSTEM_PROMPT = `You are generating bindings for U.S. tax form fields. Each binding pairs a field with a rule from our library that determines how the form engine computes its value.

${RULE_LIBRARY_SPEC}

${AVAILABLE_DATA_SPEC}

Picking rules:
  - Identity / single-fact reads → lookupFact
  - Sum across many similar facts → sumFacts
  - Pass through a decision into a single_select / text field → lookupDecision
  - multi_select / single_select form fields (radio groups) → decisionIfEquals (mode 1)
  - Per-checkbox boolean field driven by a decision → decisionIfEquals (mode 2 with matchValue)
  - Filing-status-keyed constant (standard deduction, personal-exemption count, etc.) → tableLookupByDecision
  - Math over other lines → fromFields
  - Tax line that uses a published Tax Table → taxTable (with tableId for state forms)
  - Genuinely fixed value (tax year date, IRS-defined boilerplate) → constant
  - Anything else we haven't built ingestion / scenarios for → unsupported

If a field's catalog valueType is "multi_select" OR "single_select" you MUST use decisionIfEquals — Never bind those fields with lookupDecision (that returns the raw string and skips the catalog's option→widget mapping).

State-form patterns (apply when jurisdiction is "state-ca", "state-ny", etc.):
  - **State tax table** — taxTable rule with tableId="<jurisdiction>-<year>". CA 540 line 31: { decisionKey: "decisions.scope.filing_status", inputFieldId: "form-540.line.19_taxable_income", tableId: "ca-2025" }. Omitting tableId silently uses the federal table → wrong number.
  - **State standard deduction** — tableLookupByDecision with the state's inline amounts. CA 2025: { decisionKey: "decisions.scope.filing_status", table: { single: 5706, married_filing_separately: 5706, married_filing_jointly: 11412, head_of_household: 11412, qualifying_surviving_spouse: 11412 } }.
  - **Personal-exemption amount** (Form 540 line 7) — tableLookupByDecision returning the DOLLAR AMOUNT (count × per-person $153) by filing status. CA: { decisionKey: "decisions.scope.filing_status", table: { single: 153, married_filing_separately: 153, head_of_household: 153, married_filing_jointly: 306, qualifying_surviving_spouse: 306 } }. The catalog field is named \`line.7_personal_exemption_count\` because the form has both a count widget and an amount widget per line, but the engine produces a SINGLE value per fieldId — return the dollar amount so line 11's sum produces dollars without needing a multiply rule.
  - **Blind / senior / dependent exemptions** (Form 540 lines 8, 9, 10) — bind \`unsupported\` until we ingest blind/senior facts or build dependent-data ingestion. Line 11's fromFields sum will treat these as 0 (per fromFields' partial-input contract above).
  - **Federal AGI carry-in** — fromFields cross-form ref. CA 540 line 13: { terms: [{ fieldId: "form-1040.line.11b", sign: 1, whenSourceNotRequired: 0 }] }. Use lookup_form_fields("form-1040") to confirm the exact source fieldId before binding.

When using fromFields, every term's fieldId must match an inventory entry exactly — full path including the formId prefix. For intra-form math (e.g. line 11 = line 9 − line 10) every term references the current form's fields.

**Cross-form references.** When a field's label says something like "from Form 1040 line 11b" or "from Schedule CA Part I line 27", that's a cross-form reference. The referenced form is one of the rosters listed in the inventory block. You DO NOT know the exact fieldId on the referenced form from memory — call the \`lookup_form_fields\` tool with the formId (e.g. "form-1040") to retrieve its (fieldId, label, valueType) rows. Pick the matching fieldId from the tool's response and use it in the fromFields term, with \`whenSourceNotRequired: 0\` so the engine treats a missing source-form filing as 0 rather than blocking. If the referenced form is NOT in the inventory's roster (no catalog ingested yet), bind to \`unsupported\` with a rationale naming the missing form — do not guess at fieldIds.

Don't invent facts, decisions, or field references that aren't on the inventory / Available list. If a field requires data we don't have, use \`unsupported\` with a reason — that's the honest answer. Reserve \`constant\` for values that are TRULY fixed (not "we'll fill this in later").

Rationales should be one short sentence per binding ("Sum of W-2 box 1 across employers"). The form engine surfaces rationales to debug why a value came out a certain way.

Confidence rating — be honest, this drives whether a human reviews your binding.
  - "high": you are CERTAIN this binding is correct. The label is unambiguous AND a clear data path exists (a single fact key, a known table, a clean line-arithmetic expression, or a definite "we don't model this scenario yet" gap). Most identity fields, well-understood line sums, and tax-table lookups should be high.
  - "medium": the label is clear but you're guessing about the data path. Example: a numeric field whose label says "Income from K-1 line X" but you're not sure which fact category holds K-1 data. Bind your best guess and rate medium so a human checks it.
  - "low": the field's label is ambiguous, OR you're binding to \`unsupported\` because you can't find any fact/decision/line that matches. \`unsupported\` reasons that feel like "I gave up" should be low; \`unsupported\` reasons rooted in "we explicitly don't model this scenario yet" can be high.

Don't inflate confidence — the human reviewer trusts your "high" ratings and only reviews medium/low. Over-rating "high" means buggy bindings ship.`;

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

  // Load the catalog index once. Excludes the form being bound. The
  // classifier can ask for any form's fields via `lookup_form_fields`;
  // we resolve the request out of this in-memory index.
  const catalogIndex = await loadCatalogIndex(opts.formId);
  console.log(
    `[classify-bindings] catalog index: ${catalogIndex.size} other form(s) available — ${Array.from(catalogIndex.keys()).join(", ") || "(none)"}`,
  );

  // The full inventory is cached prefix context — every batch's prompt
  // references it the same way, so prompt caching pays off heavily.
  const inventoryBlock = buildInventoryBlock(opts, catalogIndex);

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
        catalogIndex,
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
  catalogIndex: CatalogIndex,
): Promise<SingleBatchResult> {
  const fieldsTable = batch
    .map((f, i) => renderFieldEntry(i + 1, f, contextByFieldId.get(f.fieldId)))
    .join("\n\n");

  const userText = `Form: ${opts.formTitle} (${opts.formId}, tax year ${opts.taxYear}, jurisdiction ${opts.jurisdiction})

Batch ${batchIndex + 1} of ${totalBatches} — bind these ${batch.length} field(s):
${fieldsTable}

For each field, emit a binding via the emit_bindings tool. ${batchIndex === 0 ? "Also include the must-file binding for this form (the decisionKey that determines whether the form is filed at all)." : "The must-file binding has already been recorded in an earlier batch — omit it here."}

If any field references a different form (e.g. "from Form 1040 line 11b"), call lookup_form_fields with that formId BEFORE emitting the binding — you need the exact fieldId, not a guess.`;

  const tools: Anthropic.Tool[] = [
    {
      name: "emit_bindings",
      description:
        "Submit the bindings for the form fields in this batch. Each binding pairs a fieldId with a ruleName and the rule's params. Call this once you have enough information for all fields in the batch.",
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
                    "decisionIfEquals",
                    "fromFields",
                    "constant",
                    "bracketLookup",
                    "taxTable",
                    "unsupported",
                  ],
                },
                params: {
                  type: "object",
                  description:
                    "Rule-specific params. Shape depends on rule_name — see system prompt.",
                },
                rationale: { type: "string" },
                confidence: {
                  type: "string",
                  enum: ["high", "medium", "low"],
                  description:
                    "Self-rated confidence — see system prompt for the calibration guide. Over-rating 'high' means buggy bindings ship.",
                },
              },
              required: [
                "field_id",
                "rule_name",
                "params",
                "rationale",
                "confidence",
              ],
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
    {
      name: "lookup_form_fields",
      description:
        "Fetch the (fieldId, label, valueType) rows for another form's catalog. Call this when binding a cross-form reference (state→federal, schedule→parent form, etc.) before emitting a fromFields binding so you cite the correct fieldId. Returns 'not found' if the form hasn't been ingested yet — in that case bind to `unsupported` with a rationale naming the missing form.",
      input_schema: {
        type: "object",
        properties: {
          formId: {
            type: "string",
            description:
              "The formId to look up, e.g. 'form-1040', 'schedule-ca'. Must match the `form.formId` of an ingested catalog.",
          },
        },
        required: ["formId"],
      },
    },
  ];

  // Multi-turn conversation. Initial message contains the cached inventory
  // block + the per-batch user text. On each tool_use response from Claude:
  //   - lookup_form_fields → execute, append tool_result, continue
  //   - emit_bindings → that's our final answer; break
  // Cap at MAX_LOOKUPS_PER_BATCH to bound the worst case.
  const messages: Anthropic.MessageParam[] = [
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
  ];

  const usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  let finalBindings: Array<{
    field_id: string;
    rule_name: RuleName;
    params: Record<string, unknown>;
    rationale: string;
    confidence?: Confidence;
  }> | null = null;
  let finalMustFile: { decision_key: string; rationale: string } | null = null;
  let lookups = 0;

  while (true) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      tool_choice:
        lookups >= MAX_LOOKUPS_PER_BATCH
          ? { type: "tool", name: "emit_bindings" }
          : { type: "auto" },
      messages,
    });
    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_creation_input_tokens +=
      response.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

    const toolUses = response.content.filter(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
    );
    if (toolUses.length === 0) {
      throw new Error(
        `Batch ${batchIndex + 1}/${totalBatches}: no tool_use in response; stop_reason=${response.stop_reason}`,
      );
    }

    // If the model emitted the final answer, capture and stop.
    const emit = toolUses.find((t) => t.name === "emit_bindings");
    if (emit) {
      const raw = emit.input as {
        bindings?: Array<{
          field_id: string;
          rule_name: RuleName;
          params: Record<string, unknown>;
          rationale: string;
          confidence?: Confidence;
        }>;
        must_file?: { decision_key: string; rationale: string };
      };
      if (!raw?.bindings || !Array.isArray(raw.bindings)) {
        throw new Error(
          `Batch ${batchIndex + 1}/${totalBatches}: emit_bindings missing bindings array. stop_reason=${response.stop_reason}.`,
        );
      }
      finalBindings = raw.bindings;
      finalMustFile = raw.must_file ?? null;
      break;
    }

    // Otherwise we got lookup_form_fields calls — execute each, append
    // assistant + tool_result blocks, loop.
    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      if (tu.name !== "lookup_form_fields") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `Unknown tool: ${tu.name}`,
          is_error: true,
        });
        continue;
      }
      const input = tu.input as { formId?: string };
      if (!input.formId || typeof input.formId !== "string") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: "lookup_form_fields: missing or invalid `formId` arg.",
          is_error: true,
        });
        continue;
      }
      const indexed = catalogIndex.get(input.formId);
      if (!indexed) {
        const known = Array.from(catalogIndex.keys()).sort();
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: `No catalog found for "${input.formId}". Known formIds: ${known.length > 0 ? known.join(", ") : "(none)"}. If you need a binding that references this form, use \`unsupported\` with a rationale naming the missing form.`,
        });
        continue;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: formatIndexedForm(indexed),
      });
      lookups++;
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!finalBindings) {
    throw new Error(
      `Batch ${batchIndex + 1}/${totalBatches}: loop exited without emit_bindings.`,
    );
  }

  return {
    bindings: finalBindings.map((b) => ({
      fieldId: b.field_id,
      ruleName: b.rule_name,
      params: b.params,
      // Default when the AI omits rationale despite the tool schema marking
      // it required (intermittent failure mode). Keeps the workflow's
      // input-validation step from failing the whole bind over 1-3
      // missing strings out of ~170.
      rationale: b.rationale ?? `(no rationale provided — rule=${b.rule_name})`,
      // Same defensive default: if the AI omits confidence, mark "low" so
      // a human reviews instead of trusting an unrated binding.
      confidence: b.confidence ?? "low",
    })),
    mustFile: finalMustFile
      ? {
          decisionKey: finalMustFile.decision_key,
          rationale: finalMustFile.rationale,
        }
      : null,
    usage,
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
function buildInventoryBlock(
  opts: ClassifyBindingsOpts,
  catalogIndex: CatalogIndex,
): string {
  const lines = opts.fields.map(
    (f) =>
      `  ${f.fieldId} — "${f.label}" (category=${f.category}, valueType=${f.valueType})`,
  );
  // Other forms available via lookup_form_fields. The classifier only
  // sees a roster here (formId + title + jurisdiction); detailed fields
  // come back when it actually calls lookup_form_fields(formId).
  const otherForms = Array.from(catalogIndex.values()).map(
    (f) =>
      `  - ${f.formId} — ${f.title} (${f.jurisdiction}, ${f.fields.length} fields)`,
  );
  const otherFormsBlock =
    otherForms.length > 0
      ? `Other ingested forms you may reference via lookup_form_fields (do not guess their fieldIds — call the tool to fetch them):
${otherForms.join("\n")}`
      : `No other forms are ingested yet. Any cross-form reference must bind to \`unsupported\` with a rationale naming the missing form.`;
  return `Form being bound: ${opts.formTitle} (${opts.formId}, tax year ${opts.taxYear})

${otherFormsBlock}

Full field inventory of THIS form (${opts.fields.length} fields — use these fieldIds for any same-form fromFields references):
${lines.join("\n")}`;
}
