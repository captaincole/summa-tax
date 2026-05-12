// Form engine — binding registry + Catalog-driven evaluator.
//
// Generated files (e.g. `forms/generated/form-1040.ts`) register bindings
// by side effect on import: `bindField(formId, fieldId, rule, params)` and
// `bindMustFile(formId, rule, params)`. The engine evaluates a form by
// joining those bindings against a `Catalog`, which supplies the
// inventory side (label, category, valueType, position) for every field.
//
// Two stores back the Catalog:
//   - Phase B+   JSON fixtures in `apps/agent/fixtures/forms/<form>.json`
//   - Phase C+   Supabase tables (`forms`, `form_fields`) written by the
//                AI ingestion pipeline.
// Both round-trip through `Catalog`, so the engine doesn't know which
// store it's reading from.

import { z } from "zod";
import {
  blocked,
  type AnyFormField,
  type DerivationContext,
  type DerivationResult,
  type EvaluatedForm,
} from "./types.js";
import type { Catalog, FieldInventory } from "./catalog.js";

// ─── Public shapes ───────────────────────────────────────────────────────

export interface Rule<Params = unknown, V = unknown> {
  name: string;
  paramsSchema: z.ZodType<Params>;
  evaluate: (params: Params, ctx: EngineContext) => DerivationResult<V>;
}

// EngineContext extends DerivationContext with the lookup hooks rules need
// to reach previously-evaluated fields and other forms' must-file results.
export interface EngineContext extends DerivationContext {
  /** Look up a previously-evaluated field by its fieldId. */
  fieldResult: (fieldId: string) => DerivationResult<unknown> | undefined;
  /** Look up another form's must-file result. */
  formMustFile: (formId: string) => DerivationResult<boolean> | undefined;
  /**
   * The catalog field currently being evaluated. Most rules ignore this;
   * rules whose behavior depends on per-field metadata (e.g. multi_select
   * options) read it here. Undefined when a rule is invoked outside of a
   * field-evaluation pass (e.g. must-file bindings).
   */
  field?: FieldInventory;
}

// Helper for rule modules: define a rule with type-safe params.
export function rule<P, V>(spec: {
  name: string;
  paramsSchema: z.ZodType<P>;
  evaluate: (params: P, ctx: EngineContext) => DerivationResult<V>;
}): Rule<P, V> {
  return spec;
}

// ─── Internal registry state ─────────────────────────────────────────────

interface FieldBinding {
  formId: string;
  fieldId: string;
  rule: Rule;
  params: unknown;
}

interface MustFileBinding {
  rule: Rule<unknown, unknown>;
  params: unknown;
}

const mustFileBindings = new Map<string, MustFileBinding>();
const fieldBindings = new Map<string, FieldBinding>(); // keyed by fieldId

// ─── Registration API (used by generated files) ──────────────────────────

// Accepts any rule — the engine coerces the result's value to boolean at
// evaluation time. This lets `lookupDecision` (which returns the decision
// value as-is) be reused for must-file bindings without a typed-bool wrapper.
export function bindMustFile<P>(
  formId: string,
  ruleDef: Rule<P, unknown>,
  params: P,
): void {
  ruleDef.paramsSchema.parse(params);
  mustFileBindings.set(formId, {
    rule: ruleDef as Rule<unknown, unknown>,
    params,
  });
}

export function bindField<P>(
  formId: string,
  fieldId: string,
  ruleDef: Rule<P>,
  params: P,
): void {
  ruleDef.paramsSchema.parse(params);
  fieldBindings.set(fieldId, {
    formId,
    fieldId,
    rule: ruleDef as Rule,
    params,
  });
}

// ─── Inspection API ──────────────────────────────────────────────────────

/** Test-only: clears all registrations. Production callers never use this. */
export function _resetRegistryForTests(): void {
  mustFileBindings.clear();
  fieldBindings.clear();
}

// ─── Evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate a single form against the supplied Catalog. Fields are iterated
 * in Catalog ordinal order, so intra-form arithmetic (e.g. line 11 = line
 * 9 − line 10) works as long as inventory is ordered top-to-bottom in the
 * fixture / DB. Cross-form references read from prior evaluations on the
 * same engine pass — see `evaluateAllForms` (added in Phase F) for the
 * topological scheduler that makes that safe.
 */
export function evaluateForm(
  formId: string,
  ctx: DerivationContext,
  catalog: Catalog,
): EvaluatedForm<AnyFormField> {
  const def = catalog.getForm(formId);
  if (!def) {
    throw new Error(
      `evaluateForm: no form "${formId}" in the Catalog. ` +
        `Did you forget to load its fixture / seed the DB?`,
    );
  }

  const fieldResults = new Map<string, DerivationResult<unknown>>();
  const formMustFiles = new Map<string, DerivationResult<boolean>>();

  const engineCtx: EngineContext = {
    ...ctx,
    fieldResult: (id) => fieldResults.get(id),
    formMustFile: (id) => formMustFiles.get(id),
  };

  // Resolve must-file first. Coerce the rule's value to boolean — must-file
  // bindings use `lookupDecision` which returns the raw decision value, and
  // `decision.decision === true` is the canonical "must file" check.
  const mf = mustFileBindings.get(formId);
  let mustFile: DerivationResult<boolean>;
  if (!mf) {
    mustFile = blocked(`No must-file binding registered for ${formId}`);
  } else {
    const raw = mf.rule.evaluate(mf.params, engineCtx);
    mustFile = raw.ok
      ? {
          ok: true,
          value: raw.value === true,
          rationale: raw.rationale,
          supportingFactKeys: raw.supportingFactKeys,
          decisionKey: raw.decisionKey,
        }
      : raw;
  }
  formMustFiles.set(formId, mustFile);

  const fields: AnyFormField[] = [];

  // If must-file is blocked or false, return immediately with no fields.
  // Matches the prior form1040/form540 behavior — saves a lot of cascading
  // blocks downstream when a form turns out not to apply at all.
  if (!mustFile.ok || !mustFile.value) {
    return {
      formId: def.formId,
      jurisdiction: def.jurisdiction,
      title: def.title,
      taxYear: ctx.taxYear,
      mustFile,
      fields,
    };
  }

  // Walk the Catalog's inventory in order. For each field, look up the
  // binding registered by the generated TS. Missing bindings surface as
  // blocked field results — that's a misalignment between the Catalog
  // (inventory) and the generated TS (behavior), worth fixing rather than
  // hiding.
  for (const inv of catalog.getFields(formId)) {
    const binding = fieldBindings.get(inv.fieldId);
    let result: DerivationResult<unknown>;
    if (!binding) {
      result = blocked(
        `No binding registered for ${inv.fieldId}. ` +
          `Either remove it from the Catalog or add a bindField call.`,
      );
    } else {
      // Per-field context — same engine context, plus a pointer to the
      // current field's inventory. Lets rules like decisionIfEquals read
      // `ctx.field.options` without needing it duplicated in params.
      const fieldCtx: EngineContext = { ...engineCtx, field: inv };
      result = binding.rule.evaluate(binding.params, fieldCtx);
    }
    fieldResults.set(inv.fieldId, result);
    fields.push({
      formFieldKind: `${formId}.${inv.valueType}`,
      fieldId: inv.fieldId,
      label: inv.label,
      category: inv.category,
      valueType: inv.valueType,
      result,
    });
  }

  return {
    formId: def.formId,
    jurisdiction: def.jurisdiction,
    title: def.title,
    taxYear: ctx.taxYear,
    mustFile,
    fields,
  };
}
