// Generic scenario runner. Given a Scenario (facts + decisions + per-form
// expected results), drives the full render pipeline (engine + PDF fill)
// for every form in scenario.forms[] entirely in memory and asserts the
// actual output against expected. Returns a RunResult so runAll.ts can
// aggregate.
//
// No network, no Supabase, no Anthropic. Suitable for pre-commit hooks.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateAllForms } from "../src/mastra/engine/engine.js";
import {
  loadFromFixtures,
  makeCatalog,
  type Catalog,
} from "../src/mastra/engine/catalog.js";
import { projectRoot } from "../src/mastra/paths.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/engine/types.js";
import { resolveFilingInfo } from "../src/mastra/engine/filingInfo.js";
import { fillForm1040 } from "../src/mastra/engine/render/fillForm1040.js";
import {
  assertEngineNumber,
  assertMatchesGolden,
  assertNotRendered,
  assertRenderedChecked,
  assertRenderedText,
} from "./helpers/assertions.js";
import { readGoldenPdfValues } from "./helpers/goldenPdf.js";
import type { RunResult, Scenario, ScenarioForm } from "./types.js";

// Cache the combined catalog (all forms loaded into one) keyed on the
// joined paths so different scenarios that touch different form sets get
// distinct catalogs. evaluateAllForms needs every referenced form in one
// catalog so cross-form lookups can resolve.
const combinedCatalogCache = new Map<string, Promise<Catalog>>();
function getCombinedCatalog(catalogPaths: string[]): Promise<Catalog> {
  const absPaths = catalogPaths.map((p) => resolve(projectRoot, p));
  const key = absPaths.slice().sort().join("|");
  const cached = combinedCatalogCache.get(key);
  if (cached) return cached;
  const promise = loadFromFixtures(absPaths);
  combinedCatalogCache.set(key, promise);
  return promise;
}

const blankPdfCache = new Map<string, Buffer>();
function getBlankPdf(blankPdfPath: string): Buffer {
  const abs = resolve(projectRoot, blankPdfPath);
  const cached = blankPdfCache.get(abs);
  if (cached) return cached;
  const buf = readFileSync(abs);
  blankPdfCache.set(abs, buf);
  return buf;
}

const registeredForms = new Set<string>();

export async function runScenario(s: Scenario): Promise<RunResult> {
  const t0 = Date.now();
  const failures: string[] = [];

  const ctx: DerivationContext = {
    taxYear: s.taxYear,
    facts: makeFactsView(s.facts),
    decisions: makeDecisionsView(s.decisions),
    // defineForm-style bindings read all their inputs through ctx.filingInfo
    // (the AI-resolver layer; hand-coded stand-in today). Populating it here
    // means every form's bindings, regardless of which shape they use, can
    // resolve. Old-DSL bindings (1040 today) ignore this field and read
    // facts/decisions directly.
    filingInfo: resolveFilingInfo({
      facts: s.facts.map((f) => ({
        key: f.key,
        value: f.value,
        category: f.category,
      })),
      decisions: s.decisions.map((d) => ({
        decisionKey: d.decisionKey,
        decision: d.decision,
      })),
    }),
  };

  // Register bindings for every form once. evaluateAllForms reads bindings
  // out of the engine registry, so all forms in the scenario need their
  // register() call to have run.
  for (const f of s.forms) {
    if (!registeredForms.has(f.formId)) {
      f.register();
      registeredForms.add(f.formId);
    }
  }

  // Single combined catalog across every form in the scenario. Lets
  // cross-form lookups (e.g. CA 540 line 13 referencing form-1040 line 11b)
  // find their target inventory rows in one place.
  const catalog = await getCombinedCatalog(s.forms.map((f) => f.catalogPath));

  // Fixpoint loop: evaluate every form, iterating until cross-form refs
  // converge. Returns a Map<formId, EvaluatedForm> + a passes/resolvedPerPass
  // diagnostic — useful when something doesn't converge.
  const { forms, passes, resolvedPerPass } = evaluateAllForms(
    s.forms.map((f) => f.formId),
    ctx,
    catalog,
  );

  // Per-form rendering + assertions.
  for (const sf of s.forms) {
    const evaluated = forms.get(sf.formId);
    if (!evaluated) {
      failures.push(`[${sf.formId}] evaluateAllForms returned no result.`);
      continue;
    }
    await assertForm(sf, evaluated, catalog, failures);
  }

  return {
    name: s.name,
    passed: failures.length === 0,
    failures,
    durationMs: Date.now() - t0,
    fixpointPasses: passes,
    resolvedPerPass,
  };
}

async function assertForm(
  sf: ScenarioForm,
  form: ReturnType<typeof evaluateAllForms>["forms"] extends Map<string, infer V> ? V : never,
  catalog: Catalog,
  failures: string[],
): Promise<void> {
  // fillForm1040 is form-agnostic despite its name — it walks the catalog
  // inventory and writes each value into the corresponding PDF widget. Same
  // function handles the 1040 and the 540; rename pending.
  const { rendered, warnings } = await fillForm1040({
    blankPdfBytes: getBlankPdf(sf.blankPdfPath),
    form,
    catalog,
  });

  const prefix = sf.formId;

  for (const [fieldId, expected] of Object.entries(sf.expected.engineFields)) {
    assertEngineNumber(form, fieldId, expected, failures, prefix);
  }
  for (const [fieldId, expected] of Object.entries(sf.expected.renderedText)) {
    assertRenderedText(rendered, fieldId, expected, failures, prefix);
  }
  for (const fieldId of sf.expected.renderedBlank) {
    assertNotRendered(rendered, fieldId, failures, prefix);
  }
  for (const fieldId of sf.expected.renderedChecked) {
    assertRenderedChecked(rendered, fieldId, failures, prefix);
  }

  // Golden-PDF widget-level diff (when a goldenPdfPath is provided).
  // Catches catalog mislabeling that the fieldId-based assertions above
  // can't see — they trust the catalog's `fieldId → widget` mapping,
  // while this layer compares directly against a CPA-completed PDF.
  if (sf.goldenPdfPath) {
    const golden = await readGoldenPdfValues(
      resolve(projectRoot, sf.goldenPdfPath),
    );
    assertMatchesGolden(rendered, golden, failures, prefix);
  }

  if (warnings.length > 0) {
    failures.push(`[${prefix}] fillForm produced ${warnings.length} warning(s):`);
    for (const w of warnings) failures.push(`  - ${w}`);
  }
}
