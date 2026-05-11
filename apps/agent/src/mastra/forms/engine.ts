// Form engine — registry + evaluator.
//
// Each form is built up by side-effect registration: importing a generated
// file (e.g. `forms/generated/form-1040.ts`) calls `registerForm`,
// `bindMustFile`, and `bindField` against module-level Maps in this file.
// Once all registrations have run, `evaluateForm(formId, ctx)` walks the
// form's bindings in registration order, evaluating each rule against the
// derivation context and returning an EvaluatedForm.
//
// Phase A: inventory (label, category, valueType, pdfWidgetName, position)
// is declared inline in each bindField call. Phase B moves inventory to the
// `form_fields` Supabase table; bindField's signature drops the inventory
// arg at that point and the engine reads inventory from a Catalog. The
// behavior layer (rule + params) stays in TS either way.

import { z } from "zod";
import {
  blocked,
  type AnyFormField,
  type Category,
  type DerivationContext,
  type DerivationResult,
  type EvaluatedForm,
  type FieldValueType,
} from "./types.js";

// ─── Public shapes ───────────────────────────────────────────────────────

export interface FieldInventory {
  fieldId: string;
  label: string;
  category: Category;
  valueType: FieldValueType;
  pdfWidgetName?: string;
  position?: { page: number; x: number; y: number };
}

export interface FormDefinition {
  formId: string;
  taxYear: number;
  jurisdiction: string;
  title: string;
}

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
  inventory: FieldInventory;
  rule: Rule;
  params: unknown;
}

interface MustFileBinding {
  rule: Rule<unknown, unknown>;
  params: unknown;
}

const forms = new Map<string, FormDefinition>();
const mustFileBindings = new Map<string, MustFileBinding>();
const fieldBindings = new Map<string, FieldBinding[]>();

// ─── Registration API (used by generated files) ──────────────────────────

export function registerForm(def: FormDefinition): void {
  forms.set(def.formId, def);
  if (!fieldBindings.has(def.formId)) {
    fieldBindings.set(def.formId, []);
  }
}

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
  inventory: FieldInventory,
  ruleDef: Rule<P>,
  params: P,
): void {
  ruleDef.paramsSchema.parse(params);
  const list = fieldBindings.get(formId) ?? [];
  list.push({ inventory, rule: ruleDef as Rule, params });
  fieldBindings.set(formId, list);
}

// ─── Inspection API ──────────────────────────────────────────────────────

export function listRegisteredForms(): FormDefinition[] {
  return Array.from(forms.values());
}

export function getFormDefinition(formId: string): FormDefinition | undefined {
  return forms.get(formId);
}

export function getFieldInventory(formId: string): FieldInventory[] {
  return (fieldBindings.get(formId) ?? []).map((b) => b.inventory);
}

/** Test-only: clears all registrations. Production callers never use this. */
export function _resetRegistryForTests(): void {
  forms.clear();
  mustFileBindings.clear();
  fieldBindings.clear();
}

// ─── Evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate a single form. Fields are evaluated in registration order so
 * intra-form arithmetic (e.g. line 11 = line 9 − line 10) just works as
 * long as the generated file orders bindings naturally. When we re-enable
 * cross-form refs in Phase F, we'll wrap this in a `evaluateAllForms` that
 * topologically schedules forms.
 */
export function evaluateForm(
  formId: string,
  ctx: DerivationContext,
): EvaluatedForm<AnyFormField> {
  const def = forms.get(formId);
  if (!def) {
    throw new Error(`evaluateForm: no form registered with id "${formId}"`);
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

  // Evaluate each field in registration order, recording each result so
  // subsequent fields can reference it via ctx.fieldResult.
  const list = fieldBindings.get(formId) ?? [];
  for (const b of list) {
    const result = b.rule.evaluate(b.params, engineCtx);
    fieldResults.set(b.inventory.fieldId, result);
    fields.push({
      formFieldKind: `${formId}.${b.inventory.valueType}`,
      fieldId: b.inventory.fieldId,
      label: b.inventory.label,
      category: b.inventory.category,
      valueType: b.inventory.valueType,
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
