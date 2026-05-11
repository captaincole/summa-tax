import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listFacts, type TaxFactRow } from "../db/taxFacts";
import { listDecisions, type AIDecisionRow } from "../db/aiDecisions";
import {
  makeDecisionsView,
  makeFactsView,
  type BaseFormField,
  type DerivationContext,
} from "../forms/types";
import { evaluateForm } from "../forms/engine";
import { loadFromFixtures, type Catalog } from "../forms/catalog";
import { projectRoot } from "../paths";
// Side-effect import: registers form-1040 bindings with the engine. Phase F
// adds imports for 540, 8949, Schedule D back here as they're re-implemented
// in the new style.
import "../forms/generated/form-1040";
import { requireUserContext } from "./userContext";

// Catalog (form inventory) lives in JSON fixtures. We point at the
// Phase C AI-extracted catalog (197 fields) because that's what the
// AI-generated bindings in `forms/generated/form-1040.ts` were produced
// against — catalog + bindings have to share the same fieldId set or the
// engine surfaces "no binding registered" blocks for the mismatched fields.
//
// Regeneration: `npm run forms:ingest` rewrites the .extracted.json,
// `npm run forms:bind` rewrites the bindings. Both should run together.
const CATALOG_FIXTURES = [
  resolve(projectRoot, "fixtures/forms/form-1040-2025.extracted.json"),
];

let catalogPromise: Promise<Catalog> | null = null;
function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = loadFromFixtures(CATALOG_FIXTURES);
  }
  return catalogPromise;
}

// Live case state for Thom. Runs the four-form engine against the current
// fact + decision state and returns:
//   - per-form summaries (formId, mustFile result, line count, blockers)
//   - aggregated pending decisions (unique decisionKeys any form is blocked on)
//   - convenience money fields pulled from Form 1040 / CA 540 specific lines
//   - the most recent AI decisions for activity-feed display
//
// Thom calls this at the start of every turn to know:
//   - Which forms are required, computed, or blocked
//   - What scope decisions or facts are still missing (= what to ask next)
//   - The current refund/owed picture if computed

type EvaluatedFormSummary = {
  formId: string;
  jurisdiction: string;
  title: string;
  mustFile:
    | { ok: true; value: boolean; rationale: string }
    | { ok: false; reason: string; missingDecisionKey: string | null };
  fieldCount: number;
  blockedFieldCount: number;
  unsupportedFieldCount: number;
  blockers: Array<{
    fieldId: string;
    reason: string;
    missingDecisionKey: string | null;
    missingFactKeys: string[] | null;
  }>;
};

// Exported so server routes (appState.ts) can run the same computation
// outside the Mastra tool surface, with the same supabase client.
export async function buildCaseState(
  supabase: SupabaseClient,
  year: number,
) {
  const [factRows, decisionRows] = await Promise.all([
    listFacts(supabase, { taxYear: year, limit: 500 }),
    listDecisions(supabase, { taxYear: year, limit: 500 }),
  ]);

  // Supersede on conflict: most recent first per listFacts/listDecisions.
  const seenFactKeys = new Set<string>();
  const facts: TaxFactRow[] = [];
  for (const row of factRows) {
    if (!seenFactKeys.has(row.key)) {
      seenFactKeys.add(row.key);
      facts.push(row);
    }
  }
  const seenDecisionKeys = new Set<string>();
  const decisions: AIDecisionRow[] = [];
  for (const row of decisionRows) {
    if (!seenDecisionKeys.has(row.decisionKey)) {
      seenDecisionKeys.add(row.decisionKey);
      decisions.push(row);
    }
  }

  const ctx: DerivationContext = {
    taxYear: year,
    facts: makeFactsView(facts),
    decisions: makeDecisionsView(decisions),
  };

  // Phase B: only Form 1040 runs through the new engine, against the
  // fixture-loaded Catalog. 8949, Schedule D, and 540 are disabled —
  // Phase F reintroduces them in the new shape.
  const catalog = await getCatalog();
  const form1040 = evaluateForm("form-1040", ctx, catalog);

  const summaries: EvaluatedFormSummary[] = [summarizeForm(form1040)];

  // Aggregate unique pending decisions / facts across all blockers (incl.
  // mustFile blockers). Thom asks the user about these.
  const pendingDecisions = new Set<string>();
  const pendingFacts = new Set<string>();
  for (const s of summaries) {
    if (!s.mustFile.ok && s.mustFile.missingDecisionKey) {
      pendingDecisions.add(s.mustFile.missingDecisionKey);
    }
    for (const b of s.blockers) {
      if (b.missingDecisionKey) pendingDecisions.add(b.missingDecisionKey);
      for (const f of b.missingFactKeys ?? []) pendingFacts.add(f);
    }
  }

  // Identity facts aren't tracked by the form engine (they're just text to
  // fill PDF cells, not derivation inputs), but the renderers need them.
  // If any are missing, surface them as pendingFacts so Thom knows to ask
  // before generating documents.
  const REQUIRED_IDENTITY_KEYS = [
    "identity.name.first",
    "identity.name.last",
    "identity.ssn",
    "identity.dob",
    "identity.address",
  ];
  for (const key of REQUIRED_IDENTITY_KEYS) {
    if (!ctx.facts.get(key)) pendingFacts.add(key);
  }

  // Money convenience fields — read specific 1040 lines if present. State
  // (540) money is zero in Phase A; restored in Phase F.
  const money = {
    totalWages: numericField(form1040.fields, "form-1040.line.1z") ?? 0,
    federalAgi: numericField(form1040.fields, "form-1040.line.11") ?? 0,
    federalTaxableIncome: numericField(form1040.fields, "form-1040.line.15") ?? 0,
    federalTax: numericField(form1040.fields, "form-1040.line.24") ?? 0,
    federalWithholding: numericField(form1040.fields, "form-1040.line.25a") ?? 0,
    federalRefund: numericField(form1040.fields, "form-1040.line.34") ?? 0,
    federalOwed: numericField(form1040.fields, "form-1040.line.37") ?? 0,
    stateTax: 0,
    stateWithholding: 0,
    stateRefund: 0,
    stateOwed: 0,
  };

  return {
    summaries,
    pendingDecisions: Array.from(pendingDecisions).sort(),
    pendingFacts: Array.from(pendingFacts).sort(),
    money,
    factCount: facts.length,
    decisionRows,
    // Raw evaluated forms — for downstream rollups like the Filing Status
    // panel that need access to every field, not just blockers.
    evaluatedForms: [form1040],
  };
}

function summarizeForm(form: {
  formId: string;
  jurisdiction: string;
  title: string;
  mustFile:
    | { ok: true; value: boolean; rationale: string; supportingFactKeys: string[]; decisionKey?: string }
    | { ok: false; reason: string; missingDecisionKey?: string; missingFactKeys?: string[]; unsupported?: boolean };
  fields: Array<{
    fieldId: string;
    result:
      | { ok: true; value: unknown; rationale: string; supportingFactKeys: string[]; decisionKey?: string }
      | { ok: false; reason: string; missingDecisionKey?: string; missingFactKeys?: string[]; unsupported?: boolean };
  }>;
}): EvaluatedFormSummary {
  // Unsupported fields are engine gaps, not user-input gaps. They don't
  // count as blockers and don't get aggregated into pending questions.
  const blockers = form.fields
    .filter((l) => !l.result.ok && !l.result.unsupported)
    .map((l) => {
      const r = l.result as Extract<typeof l.result, { ok: false }>;
      return {
        fieldId: l.fieldId,
        reason: r.reason,
        missingDecisionKey: r.missingDecisionKey ?? null,
        missingFactKeys: r.missingFactKeys ?? null,
      };
    });
  const unsupportedFieldCount = form.fields.filter(
    (l) => !l.result.ok && l.result.unsupported,
  ).length;
  return {
    formId: form.formId,
    jurisdiction: form.jurisdiction,
    title: form.title,
    mustFile: form.mustFile.ok
      ? { ok: true, value: form.mustFile.value, rationale: form.mustFile.rationale }
      : {
          ok: false,
          reason: form.mustFile.reason,
          missingDecisionKey: form.mustFile.missingDecisionKey ?? null,
        },
    fieldCount: form.fields.length,
    blockedFieldCount: blockers.length,
    unsupportedFieldCount,
    blockers,
  };
}

// Look up a numeric field by its fieldId. Fields are heterogeneous (text,
// numeric, single_select) so we filter on result type.
function numericField(
  fields: readonly BaseFormField[],
  fieldId: string,
): number | null {
  const field = fields.find((f) => f.fieldId === fieldId);
  if (!field || !field.result.ok) return null;
  const v = field.result.value;
  return typeof v === "number" ? v : null;
}

export const getCaseState = createTool({
  id: "get-case-state",
  description:
    "Returns live case state: per-form summaries (must-file + line count + blockers), aggregated pending decisions and missing facts across all forms, and money convenience fields (wages, AGI, tax, withholding, refund/owed). Call at the start of every turn to know what's required, what's blocked, and what to ask next. The user is identified automatically — pass only the tax year.",
  inputSchema: z.object({
    year: z.number().int().describe("Tax year (e.g. 2025)"),
  }),
  outputSchema: z.object({
    forms: z.array(z.any()),
    pendingDecisions: z.array(z.string()),
    pendingFacts: z.array(z.string()),
    money: z.object({
      totalWages: z.number(),
      federalAgi: z.number(),
      federalTaxableIncome: z.number(),
      federalTax: z.number(),
      federalWithholding: z.number(),
      federalRefund: z.number(),
      federalOwed: z.number(),
      stateTax: z.number(),
      stateWithholding: z.number(),
      stateRefund: z.number(),
      stateOwed: z.number(),
    }),
    factCount: z.number(),
    aiDecisions: z.array(
      z.object({
        id: z.string(),
        decisionKey: z.string(),
        decision: z.any(),
        rationale: z.string(),
        supportingFactKeys: z.array(z.string()),
        confidence: z.string(),
        dissentingConsiderations: z.string().nullable(),
        authorityCitations: z.any().nullable(),
        createdAt: z.string(),
      }),
    ),
  }),
  execute: async (input, context) => {
    const { supabase } = requireUserContext(context);
    const { summaries, pendingDecisions, pendingFacts, money, factCount, decisionRows } =
      await buildCaseState(supabase, input.year);

    return {
      forms: summaries,
      pendingDecisions,
      pendingFacts,
      money,
      factCount,
      aiDecisions: decisionRows.map((d) => ({
        id: d.id,
        decisionKey: d.decisionKey,
        decision: d.decision,
        rationale: d.rationale,
        supportingFactKeys: d.supportingFactKeys,
        confidence: d.confidence,
        dissentingConsiderations: d.dissentingConsiderations,
        authorityCitations: d.authorityCitations,
        createdAt: d.createdAt,
      })),
    };
  },
});
