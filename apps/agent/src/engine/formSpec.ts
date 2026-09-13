// FormSpec — the shape of one registry entry, shared by the per-jurisdiction
// registries (federal/index.ts, state/*/index.ts) and composed into the
// global FORMS list in registry.ts. Lives in its own module so jurisdiction
// registries can import it without a circular dependency on registry.ts.

import { resolve } from "node:path";

// Offline paths anchor at cwd — tests, scripts, and refdocs tooling all run
// with cwd at apps/agent/ (same convention as src/paths.ts, inlined here so
// the engine imports no code from outside src/engine/).
const projectRoot = process.cwd();

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
   * export from registry.ts (sourced from the promoted copy in public/forms/).
   */
  catalogPath: string;
  /**
   * Absolute path to the OFFLINE blank.pdf under apps/agent/forms/. Used by
   * tests and one-off scripts. Production rendering reads from
   * `forms/<relativeDir>/blank.pdf` relative to cwd — see index.ts renderForm.
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

export function makeFormSpec(args: {
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
