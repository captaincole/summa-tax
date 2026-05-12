// Generic scenario runner. Given a Scenario (facts + decisions + expected),
// drives the full render pipeline (engine + PDF fill) entirely in memory
// and asserts the actual output against expected. Returns a RunResult so
// runAll.ts can aggregate.
//
// No network, no Supabase, no Anthropic. Suitable for pre-commit hooks.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateForm } from "../src/mastra/forms/engine.js";
import { loadFromFixtures, type Catalog } from "../src/mastra/forms/catalog.js";
import { projectRoot } from "../src/mastra/paths.js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/forms/types.js";
import { fillForm1040 } from "../src/mastra/forms/render/fillForm1040.js";
import { register as registerForm1040 } from "../src/mastra/forms/generated/form-1040.js";
import {
  assertEngineNumber,
  assertNotRendered,
  assertRenderedChecked,
  assertRenderedText,
} from "./helpers/assertions.js";
import type { RunResult, Scenario } from "./types.js";

// Bindings register on import; doing it here once means a runner that
// loads multiple scenarios doesn't re-register on every run (the registry
// is idempotent regardless, but this is cleaner).
registerForm1040();

// The form catalog is the same for every form-1040 scenario; load once.
let catalogPromise: Promise<Catalog> | null = null;
function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = loadFromFixtures([
      resolve(projectRoot, "fixtures/forms/form-1040-2025.extracted.json"),
    ]);
  }
  return catalogPromise;
}

// Blank-PDF bytes are large (~3MB); load once and reuse across scenarios.
let blankPdfBytes: Buffer | null = null;
function getBlank1040(): Buffer {
  if (!blankPdfBytes) {
    blankPdfBytes = readFileSync(
      resolve(projectRoot, "ref/forms/f1040-2025.pdf"),
    );
  }
  return blankPdfBytes;
}

export async function runScenario(s: Scenario): Promise<RunResult> {
  const t0 = Date.now();
  const failures: string[] = [];

  const ctx: DerivationContext = {
    taxYear: s.taxYear,
    facts: makeFactsView(s.facts),
    decisions: makeDecisionsView(s.decisions),
  };

  const catalog = await getCatalog();
  const form = evaluateForm(s.formId, ctx, catalog);

  const { rendered, warnings } = await fillForm1040({
    blankPdfBytes: getBlank1040(),
    form,
    catalog,
  });

  // ─── Engine numeric assertions ─────────────────────────────────────
  for (const [fieldId, expected] of Object.entries(s.expected.engineFields)) {
    assertEngineNumber(form, fieldId, expected, failures);
  }

  // ─── Rendered-text assertions ──────────────────────────────────────
  for (const [fieldId, expected] of Object.entries(s.expected.renderedText)) {
    assertRenderedText(rendered, fieldId, expected, failures);
  }

  // ─── Renderer-must-leave-blank assertions ──────────────────────────
  for (const fieldId of s.expected.renderedBlank) {
    assertNotRendered(rendered, fieldId, failures);
  }

  // ─── Renderer-must-check assertions ────────────────────────────────
  for (const fieldId of s.expected.renderedChecked) {
    assertRenderedChecked(rendered, fieldId, failures);
  }

  // ─── No-warnings invariant ─────────────────────────────────────────
  // A non-empty warnings list = a widget was missing, a length overflow
  // couldn't be recovered, or a widget kind didn't match the catalog's
  // declared valueType. Always a regression worth flagging.
  if (warnings.length > 0) {
    failures.push(`fillForm1040 produced ${warnings.length} warning(s):`);
    for (const w of warnings) failures.push(`  - ${w}`);
  }

  return {
    name: s.name,
    passed: failures.length === 0,
    failures,
    durationMs: Date.now() - t0,
  };
}
