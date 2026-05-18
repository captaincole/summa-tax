// Central form registry — the single source of truth for the universe of
// forms the engine can evaluate and render. Every consumer (case-state
// projection, doc-gen tool, test runner, catalog-fill checker, scenario
// definitions) imports from here rather than maintaining its own list.
//
// Adding a new form:
//   1. Drop a catalog.json + blank.pdf into apps/agent/forms/<jurisdiction>/<short>/
//   2. Write bindings.ts under apps/agent/src/mastra/engine/<jurisdiction>/<short>/
//   3. Add one entry to FORMS below
//
// That's it. No other file should know about a per-form catalog path or
// register fn. If you find yourself touching multiple files when adding
// a form, this registry isn't doing its job — surface the missing
// abstraction instead of papering over it.

import { resolve } from "node:path";
import { projectRoot } from "../paths.js";
import { register as registerForm1040 } from "./federal/1040/bindings.js";
import { register as registerForm8949 } from "./federal/8949/bindings.js";
import { register as registerScheduleD } from "./federal/schedule-d/bindings.js";
import { register as registerForm540 } from "./state/ca/540/bindings.js";
import { register as registerScheduleCa } from "./state/ca/schedule-ca/bindings.js";

export interface FormSpec {
  /** Long-form id used by the engine + bindings (e.g. "form-1040", "schedule-d"). */
  formId: string;
  /**
   * Short id used in filenames, storage slugs, and metadata tags
   * (e.g. "1040", "schedule-d", "schedule-ca"). Strips the "form-"
   * prefix on federal forms; identical to formId on schedules.
   */
  shortId: string;
  /** Human-readable name used in filenames + UI ("Form 1040", "Schedule CA (540)"). */
  displayName: string;
  /** Absolute path to the form's catalog.json (loaded by the engine). */
  catalogPath: string;
  /** Absolute path to the blank fillable PDF (rendered by fillFromCatalog). */
  blankPdfPath: string;
  /**
   * Side-effecting registration of this form's typed bindings into the
   * engine's registry. Idempotent — calling twice overwrites in place.
   * Bundlers can't tree-shake the side-effect-import idiom; we rely on
   * the explicit function call to keep bindings reachable.
   */
  register: () => void;
}

/**
 * Forms in dependency order — the engine's fixpoint evaluator walks
 * them in this sequence, and the monotonic cache means each form needs
 * its upstreams resolved first.
 *
 *   8949 → Schedule D → 1040 → Schedule CA → 540
 *
 * Trade-level transactions feed 8949 totals, which feed Schedule D lines
 * 1b/8b, which feed 1040 line 7a (net capital gain), which feeds 1040
 * line 11b (AGI), which the CA forms read cross-form for line 13.
 */
export const FORMS: FormSpec[] = [
  {
    formId: "form-8949",
    shortId: "8949",
    displayName: "Form 8949",
    catalogPath: resolve(projectRoot, "forms/federal/8949/catalog.json"),
    blankPdfPath: resolve(projectRoot, "forms/federal/8949/blank.pdf"),
    register: registerForm8949,
  },
  {
    formId: "schedule-d",
    shortId: "schedule-d",
    displayName: "Schedule D",
    catalogPath: resolve(projectRoot, "forms/federal/schedule-d/catalog.json"),
    blankPdfPath: resolve(projectRoot, "forms/federal/schedule-d/blank.pdf"),
    register: registerScheduleD,
  },
  {
    formId: "form-1040",
    shortId: "1040",
    displayName: "Form 1040",
    catalogPath: resolve(projectRoot, "forms/federal/1040/catalog.json"),
    blankPdfPath: resolve(projectRoot, "forms/federal/1040/blank.pdf"),
    register: registerForm1040,
  },
  {
    formId: "schedule-ca",
    shortId: "schedule-ca",
    displayName: "Schedule CA (540)",
    catalogPath: resolve(projectRoot, "forms/state/ca/schedule-ca/catalog.json"),
    blankPdfPath: resolve(projectRoot, "forms/state/ca/schedule-ca/blank.pdf"),
    register: registerScheduleCa,
  },
  {
    formId: "form-540",
    shortId: "540",
    displayName: "Form 540",
    catalogPath: resolve(projectRoot, "forms/state/ca/540/catalog.json"),
    blankPdfPath: resolve(projectRoot, "forms/state/ca/540/blank.pdf"),
    register: registerForm540,
  },
];

/** Look up a single FormSpec. Throws (with a useful list) on miss. */
export function getFormSpec(formId: string): FormSpec {
  const spec = FORMS.find((f) => f.formId === formId);
  if (!spec) {
    throw new Error(
      `No FormSpec registered for formId "${formId}". ` +
        `Known formIds: ${FORMS.map((f) => f.formId).join(", ")}. ` +
        `Add a new entry to FORMS in src/mastra/engine/registry.ts to support it.`,
    );
  }
  return spec;
}

/** Invoke every form's register() once. Idempotent. Call at module load. */
export function registerAllForms(): void {
  for (const spec of FORMS) spec.register();
}
