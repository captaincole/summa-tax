// Central form registry — the single source of truth for the universe of
// forms the engine can evaluate and render. Every consumer (case-state
// projection, doc-gen tool, test runner, catalog-fill checker, scenario
// definitions) imports from here rather than maintaining its own list.
//
// Adding a new form:
//   1. Drop a catalog.json + blank.pdf into apps/agent/forms/<jurisdiction>/<short>/
//   2. Write bindings.ts under apps/agent/src/mastra/engine/<jurisdiction>/<short>/
//   3. Add one entry to FORMS below
//   4. Add the catalog.json to the static-import block + the `catalog`
//      construction array below
//
// If you find yourself touching more than these files when adding a form,
// this registry isn't doing its job — surface the missing abstraction
// instead of papering over it.

import { resolve } from "node:path";
import { projectRoot } from "../paths.js";
import {
  buildCatalogFromFixtures,
  fixtureFileSchema,
  type Catalog,
} from "./catalog.js";
import { register as registerForm1040 } from "./federal/1040/bindings.js";
import { register as registerForm8949 } from "./federal/8949/bindings.js";
import { register as registerScheduleD } from "./federal/schedule-d/bindings.js";
import { register as registerScheduleA } from "./federal/schedule-a/bindings.js";
import { register as registerForm540 } from "./state/ca/540/bindings.js";
import { register as registerScheduleCa } from "./state/ca/schedule-ca/bindings.js";

// Static JSON imports — sourced from the PROMOTED runtime copies under
// src/mastra/public/forms/, not the offline source-of-truth at
// apps/agent/forms/. This gives us a promotion gate: ingesting a new
// catalog updates apps/agent/forms/ (tests run against it), and only
// after a `forms:promote` cp does the runtime pick up the change.
// Rollup inlines these JSON contents at build time, and Mastra's
// copyPublic step ships the same files into /var/task/forms/... on
// Vercel — but nothing reads them from disk; the bundled values are
// the source of truth for the running process.
// fixtureFileSchema.parse() narrows TypeScript's widened JSON types
// (e.g. `category: string` → `category: Category`) and fails loud at
// boot if any catalog drifts from FixtureFile.
import form8949CatalogJson from "../public/forms/federal/8949/catalog.json";
import scheduleDCatalogJson from "../public/forms/federal/schedule-d/catalog.json";
import scheduleACatalogJson from "../public/forms/federal/schedule-a/catalog.json";
import form1040CatalogJson from "../public/forms/federal/1040/catalog.json";
import scheduleCaCatalogJson from "../public/forms/state/ca/schedule-ca/catalog.json";
import form540CatalogJson from "../public/forms/state/ca/540/catalog.json";

const form8949Catalog = fixtureFileSchema.parse(form8949CatalogJson);
const scheduleDCatalog = fixtureFileSchema.parse(scheduleDCatalogJson);
const scheduleACatalog = fixtureFileSchema.parse(scheduleACatalogJson);
const form1040Catalog = fixtureFileSchema.parse(form1040CatalogJson);
const scheduleCaCatalog = fixtureFileSchema.parse(scheduleCaCatalogJson);
const form540Catalog = fixtureFileSchema.parse(form540CatalogJson);

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
  /**
   * Per-form subpath under both `forms/` (offline) and `src/mastra/public/forms/`
   * (runtime). E.g. "federal/1040", "state/ca/schedule-ca". Used by the engine
   * renderer to construct cwd-relative paths to blank.pdf — works in dev
   * (cwd = src/mastra/public/), prod (cwd = /var/task, Mastra's copyPublic
   * step puts the same forms/ tree there), and tests/scripts (cwd = apps/agent/,
   * offline source-of-truth at forms/).
   */
  relativeDir: string;
  /**
   * Absolute path to the OFFLINE catalog.json under apps/agent/forms/. Used by
   * tests and one-off scripts that load arbitrary catalog files from disk via
   * `loadFromFixtures([...])`. Production code paths use the bundled `catalog`
   * export below (sourced from the promoted copy in public/forms/) instead.
   */
  catalogPath: string;
  /**
   * Absolute path to the OFFLINE blank.pdf under apps/agent/forms/. Used by
   * tests and one-off scripts. Production rendering reads from
   * `forms/<relativeDir>/blank.pdf` relative to cwd — see engine/renderer.ts.
   */
  blankPdfPath: string;
  /**
   * Side-effecting registration of this form's typed bindings into the
   * engine's registry. Idempotent — calling twice overwrites in place.
   * Bundlers can't tree-shake the side-effect-import idiom; we rely on
   * the explicit function call to keep bindings reachable.
   *
   * Optional: a form may be registered for catalog-fill regression
   * coverage before bindings exist. With no register fn, the form's
   * FormFields evaluate to undefined and the renderer produces a blank
   * PDF — harmless as long as no scenario asks the form to be filed.
   */
  register?: () => void;
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
function makeFormSpec(args: {
  formId: string;
  shortId: string;
  displayName: string;
  relativeDir: string;
  register?: () => void;
}): FormSpec {
  return {
    ...args,
    catalogPath: resolve(projectRoot, "forms", args.relativeDir, "catalog.json"),
    blankPdfPath: resolve(projectRoot, "forms", args.relativeDir, "blank.pdf"),
  };
}

export const FORMS: FormSpec[] = [
  makeFormSpec({
    formId: "form-8949",
    shortId: "8949",
    displayName: "Form 8949",
    relativeDir: "federal/8949",
    register: registerForm8949,
  }),
  makeFormSpec({
    formId: "schedule-d",
    shortId: "schedule-d",
    displayName: "Schedule D",
    relativeDir: "federal/schedule-d",
    register: registerScheduleD,
  }),
  makeFormSpec({
    formId: "form-1040",
    shortId: "1040",
    displayName: "Form 1040",
    relativeDir: "federal/1040",
    register: registerForm1040,
  }),
  makeFormSpec({
    formId: "schedule-ca",
    shortId: "schedule-ca",
    displayName: "Schedule CA (540)",
    relativeDir: "state/ca/schedule-ca",
    register: registerScheduleCa,
  }),
  makeFormSpec({
    formId: "form-540",
    shortId: "540",
    displayName: "Form 540",
    relativeDir: "state/ca/540",
    register: registerForm540,
  }),
  makeFormSpec({
    formId: "schedule-a",
    shortId: "schedule-a",
    displayName: "Schedule A",
    relativeDir: "federal/schedule-a",
    register: registerScheduleA,
  }),
  // Catalog-only entries (no bindings yet — deferred). These exist so the
  // catalog-fill regression test in runAll.ts checks them against their
  // blank PDFs. Bindings + downstream wiring land in a follow-up PR.
  makeFormSpec({
    formId: "schedule-b",
    shortId: "schedule-b",
    displayName: "Schedule B",
    relativeDir: "federal/schedule-b",
  }),
  // No instructions.pdf in schedule-2/ by design — IRS publishes Schedule 2
  // instructions only as part of the 1040 instructions booklet (already in
  // the corpus as irs-1040-inst-2025), so the cross-reference is implicit.
  makeFormSpec({
    formId: "schedule-2",
    shortId: "schedule-2",
    displayName: "Schedule 2",
    relativeDir: "federal/schedule-2",
  }),
  makeFormSpec({
    formId: "form-8889",
    shortId: "8889",
    displayName: "Form 8889",
    relativeDir: "federal/8889",
  }),
  makeFormSpec({
    formId: "form-8959",
    shortId: "8959",
    displayName: "Form 8959",
    relativeDir: "federal/8959",
  }),
  makeFormSpec({
    formId: "form-8960",
    shortId: "8960",
    displayName: "Form 8960",
    relativeDir: "federal/8960",
  }),
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
  for (const spec of FORMS) spec.register?.();
}

/**
 * Merged, in-memory catalog spanning every form. Built once at module
 * load from the static JSON imports above — no I/O, no filesystem
 * dependency. Consumers in the prod hot path (`buildCaseState`,
 * `generateTaxDocuments`) import this directly instead of loading
 * catalogs from disk.
 */
export const catalog: Catalog = buildCatalogFromFixtures([
  form8949Catalog,
  scheduleDCatalog,
  scheduleACatalog,
  form1040Catalog,
  scheduleCaCatalog,
  form540Catalog,
]);
