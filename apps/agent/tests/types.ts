// Scenario type — the contract every test scenario implements.
//
// A Scenario bundles its inputs (facts + decisions) with its expected
// outputs (engine field values + rendered widget values). The shared
// runner (runScenario.ts) takes one of these and produces a RunResult.
//
// Adding a new scenario = create tests/scenarios/<name>/{facts,decisions,
// expected,index}.ts following the Alex pattern; export a Scenario from
// index.ts; add it to runAll.ts.

import type { TaxFactRow } from "../src/mastra/db/taxFacts.js";
import type { AIDecisionRow } from "../src/mastra/db/aiDecisions.js";

export interface ScenarioForm {
  /**
   * Form to evaluate + assert against. The runner looks up the spec
   * (catalog path, blank PDF, register fn) from the shared registry
   * (`src/engine/registry.ts`) — scenarios don't repeat that
   * config.
   */
  formId: string;
  /**
   * Path to a CPA-completed "golden" PDF for this scenario+form. The runner
   * reads every filled widget out of this PDF and diffs against our render
   * — bypasses the catalog's fieldId→widget mapping, so catalog mislabels
   * surface immediately. Optional; when absent, only the fixture-based
   * assertions run. Scenario-specific (e.g. Alex's golden, Alejandro's
   * golden) so it lives here, not in the registry.
   */
  goldenPdfPath?: string;
  expected: ExpectedResults;
}

export interface Scenario {
  /** Short id used in CLI output (e.g. "alex"). Must be unique. */
  name: string;
  /** One-line human description for the summary banner. */
  description: string;
  taxYear: number;
  /** Stable id used as the synthetic user for these in-memory fixtures. */
  userId: string;
  facts: TaxFactRow[];
  decisions: AIDecisionRow[];
  /** Forms this scenario evaluates + asserts on. Order is reporting order. */
  forms: ScenarioForm[];
}

export interface ExpectedResults {
  /**
   * Engine field results: fieldId → expected numeric value. The runner
   * asserts each one against the evaluated form's typed numeric result.
   * Use this for line values (1z, 12e, 15, 16, 34, …).
   */
  engineFields: Record<string, number>;

  /**
   * Rendered text widgets: fieldId → expected string written to the PDF
   * widget. Money values render as integer strings (fmtMoney). Text fields
   * render verbatim except SSN/phone-style values whose widget has a
   * smaller maxLength than the canonical fact value — those get separator-
   * stripped by the renderer. Express the post-render form here (e.g.
   * "123456789" not "123-45-6789").
   */
  renderedText: Record<string, string>;

  /**
   * Field ids that MUST NOT have a rendered widget at all. Use for
   * deliberately-blank lines (e.g. the fiscal-year header dates that only
   * non-calendar filers fill).
   */
  renderedBlank: string[];

  /**
   * Field ids whose multi_select binding should produce at least one
   * checked widget. Doesn't pin a specific option — proves the rule
   * mapped the decision to a PDF checkbox.
   */
  renderedChecked: string[];
}

export interface RunResult {
  name: string;
  passed: boolean;
  failures: string[];
  /** How long this scenario took, in ms. Useful for pre-commit budgeting. */
  durationMs: number;
  /** How many fixpoint passes the engine needed for cross-form refs to settle. */
  fixpointPasses?: number;
  /** Newly-resolved `ok` results per pass. Last entry should be 0 (convergence). */
  resolvedPerPass?: number[];
}
