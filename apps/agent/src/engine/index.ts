// Engine public API. Tools / HTTP routes / scripts call into the engine
// through these two functions:
//
//   evaluateScenario({filing, facts, decisions, authEmail?}) → EvaluatedScenario
//   renderForm(scenario, formId)                             → RenderedForm
//
// The engine never touches a database: callers load the filing's fact and
// decision rows (see mastra/loadScenario.ts for the runtime bridge) and
// pass them in, newest-first. evaluateScenario supersedes them to
// most-recent-per-key, projects them into FilingInfo, and fixpoint-
// evaluates every registered form against the resulting context. It
// returns the raw evaluated forms map plus the underlying facts /
// decisions / filingInfo / authEmail so downstream consumers
// (case-state summarizer, document generator) can compute their own
// derived views without re-reading anything. authEmail is enrichment-only
// (Luca acknowledges it back to the user at doc-gen time) — callers pass
// it from the JWT email claim; it's never load-bearing for evaluation.
//
// renderForm fills the catalog widgets on a form's blank PDF with the
// values produced by evaluateScenario. The blank PDF lives at
// `forms/<spec.relativeDir>/blank.pdf` relative to cwd — Mastra's
// copyPublic step ships src/mastra/public/forms/** into /var/task/forms
// on Vercel, and `mastra dev` runs with cwd at src/mastra/public, so
// the same relative path works in dev, prod, and offline scripts.
//
// Neither function touches Supabase Storage or user_documents. Tools
// wrap renderForm with createDocument() to persist a user-visible draft.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { TaxFactRow } from "./facts/rows.js";
import type { AIDecisionRow } from "./facts/rows.js";
import { evaluateAllForms } from "./engine.js";
import { resolveFilingInfo, type FilingInfo } from "./filingInfo.js";
import { fillFromCatalog, type RenderedWidget } from "./render/fillFromCatalog.js";
import {
  FORMS,
  catalog as bundledCatalog,
  getFormSpec,
  registerAllForms,
} from "./registry.js";
import {
  makeDecisionsView,
  makeFactsView,
  type AnyFormField,
  type DerivationContext,
  type EvaluatedForm,
} from "./types.js";

export interface EngineFiling {
  id: string;
  taxYear: number;
}

export interface ScenarioInputs {
  filing: EngineFiling;
  /** Raw rows, newest-first (as list* returns them); the engine supersedes. */
  facts: TaxFactRow[];
  decisions: AIDecisionRow[];
  authEmail?: string | null;
}

export interface EvaluatedScenario {
  filing: EngineFiling;
  /** Superseded — one row per key, most recent. */
  facts: TaxFactRow[];
  /** Superseded — one row per decisionKey, most recent. */
  decisions: AIDecisionRow[];
  filingInfo: FilingInfo;
  authEmail: string | null;
  /** Every registered form, keyed by formId. */
  forms: Map<string, EvaluatedForm<AnyFormField>>;
}

export interface RenderedForm {
  pdfBytes: Buffer;
  rendered: Map<string, RenderedWidget[]>;
  warnings: string[];
}

// Only evaluate forms that have bindings (a `register` fn). The bundled
// runtime `catalog` spans exactly these forms; the "catalog-only" entries
// in FORMS (schedule-b, schedule-2, 8889, 8960) exist solely for the
// catalog-fill regression test (which loads catalogs from disk) and have no
// bindings + are NOT in the bundled catalog — evaluating them here would
// throw "no form … in the Catalog" and 500 the whole case-state build.
const SCENARIO_FORM_IDS = FORMS.filter((f) => f.register).map((f) => f.formId);

/**
 * Collapse a list to most-recent-per-key. Caller-supplied keyer extracts the
 * dedup key; rows arrive newest-first from list*, so first-seen wins.
 */
function supersede<T>(rows: T[], keyer: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyer(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function evaluateScenario(inputs: ScenarioInputs): EvaluatedScenario {
  const { filing, authEmail = null } = inputs;

  // Register all form bindings before evaluation. Idempotent — calling
  // twice overwrites in place — and cheap, so we do it on every call
  // rather than rely on module-load side effects.
  registerAllForms();

  const facts = supersede(inputs.facts, (r) => r.key);
  const decisions = supersede(inputs.decisions, (r) => r.decisionKey);

  const filingInfo = resolveFilingInfo({
    facts: facts.map((f) => ({ key: f.key, value: f.value, category: f.category })),
    decisions: decisions.map((d) => ({ decisionKey: d.decisionKey, decision: d.decision })),
  });

  const ctx: DerivationContext = {
    taxYear: filing.taxYear,
    facts: makeFactsView(facts),
    decisions: makeDecisionsView(decisions),
    // Bindings read every input through ctx.filingInfo (the resolver-
    // projected view of facts + decisions). Without this, every binding
    // short-circuits to a "filingInfo missing" block and forms render empty.
    filingInfo,
  };

  const { forms } = evaluateAllForms(SCENARIO_FORM_IDS, ctx, bundledCatalog);

  return { filing, facts, decisions, filingInfo, authEmail, forms };
}

/**
 * Render one of the scenario's evaluated forms to PDF bytes. Reads the
 * blank PDF from disk relative to cwd — see file header for why this
 * path resolution works across dev, prod, and offline scripts.
 *
 * Returns the filled PDF, a map of rendered widgets (useful for tests
 * asserting on rendered values), and a warnings list (widget missing,
 * maxLength exceeded, etc. — non-empty means a soft regression).
 */
export async function renderForm(
  scenario: EvaluatedScenario,
  formId: string,
): Promise<RenderedForm> {
  const spec = getFormSpec(formId);
  const form = scenario.forms.get(formId);
  if (!form) {
    throw new Error(
      `renderForm: no evaluation result for formId "${formId}". ` +
        `Was evaluateScenario called with a registry that includes this form?`,
    );
  }
  const blankPdfPath = resolve(
    process.cwd(),
    "forms",
    spec.relativeDir,
    "blank.pdf",
  );
  const blankPdfBytes = await readFile(blankPdfPath);
  return fillFromCatalog({ blankPdfBytes, form, catalog: bundledCatalog });
}
