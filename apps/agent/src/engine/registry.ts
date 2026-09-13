// Central form registry — composes the per-jurisdiction registries into
// the single universe of forms the engine can evaluate and render. Every
// consumer (case-state projection, doc-gen tool, test runner, catalog-fill
// checker, scenario definitions) imports from here rather than maintaining
// its own list.
//
// The actual form entries live with their jurisdiction:
//   federal forms → ./federal/index.ts
//   state forms   → ./state/<st>/index.ts, composed by ./state/index.ts
//
// Federal comes first: state forms read federal results cross-form (CA 540
// line 13 ← 1040 AGI), and listing upstreams first lets the fixpoint
// evaluator converge in fewer passes. Order affects pass count, never
// correctness — see evaluateAllForms in engine.ts.

import { buildCatalogFromFixtures, type Catalog } from "./catalog.js";
import { FEDERAL_FORMS, FEDERAL_CATALOGS } from "./federal/index.js";
import { STATE_FORMS, STATE_CATALOGS } from "./state/index.js";
import type { FormSpec } from "./formSpec.js";

export { makeFormSpec, type FormSpec } from "./formSpec.js";

export const FORMS: FormSpec[] = [...FEDERAL_FORMS, ...STATE_FORMS];

/** Look up a single FormSpec. Throws (with a useful list) on miss. */
export function getFormSpec(formId: string): FormSpec {
  const spec = FORMS.find((f) => f.formId === formId);
  if (!spec) {
    throw new Error(
      `No FormSpec registered for formId "${formId}". ` +
        `Known formIds: ${FORMS.map((f) => f.formId).join(", ")}. ` +
        `Add an entry to the form's jurisdiction registry ` +
        `(src/engine/federal/index.ts or src/engine/state/<st>/index.ts) to support it.`,
    );
  }
  return spec;
}

/** Invoke every form's register() once. Idempotent. Call at module load. */
export function registerAllForms(): void {
  for (const spec of FORMS) spec.register?.();
}

/**
 * Merged, in-memory catalog spanning every form with bindings. Built once
 * at module load from the jurisdiction registries' static JSON imports —
 * no I/O, no filesystem dependency. Consumers in the prod hot path
 * (`buildCaseState`, `generateTaxDocuments`) import this directly instead
 * of loading catalogs from disk.
 */
export const catalog: Catalog = buildCatalogFromFixtures([
  ...FEDERAL_CATALOGS,
  ...STATE_CATALOGS,
]);
