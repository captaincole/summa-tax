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
} from "../engine/types";
import { evaluateAllForms } from "../engine/engine";
import { resolveFilingInfo } from "../engine/filingInfo";
import { loadFromFixtures, type Catalog } from "../engine/catalog";
import { projectRoot } from "../paths";
// Explicit register() calls so the bundler / dev server can't tree-shake
// the side-effect-import idiom. Idempotent — bindings overwrite themselves
// if called twice.
import { register as registerForm1040 } from "../engine/federal/1040/bindings";
import { register as registerForm540 } from "../engine/state/ca/540/bindings";
import { register as registerScheduleCa } from "../engine/state/ca/schedule-ca/bindings";
import { register as registerForm8949 } from "../engine/federal/8949/bindings";
registerForm1040();
registerForm540();
registerScheduleCa();
registerForm8949();
import { requireUserContext } from "./userContext";

// Catalogs (form inventories) live in `forms/<jurisdiction>/<short>/catalog.json`.
// One combined Catalog loads all of them so cross-form references resolve
// during evaluateAllForms — e.g. form-540.line.13_federal_agi reads
// form-1040.line.11b after the federal AGI is computed.
//
// Regeneration: `npm run forms:ingest --form-id=X` rewrites the catalog JSON
// for X; `npm run forms:bind --form-id=X` rewrites X's bindings.
const CATALOG_FILES = [
  resolve(projectRoot, "forms/federal/1040/catalog.json"),
  resolve(projectRoot, "forms/federal/8949/catalog.json"),
  resolve(projectRoot, "forms/state/ca/540/catalog.json"),
  resolve(projectRoot, "forms/state/ca/schedule-ca/catalog.json"),
];
// Order matters: forms are evaluated in this sequence each fixpoint pass,
// and the engine's monotonic cache means once a field resolves it stays
// put. Schedule CA reads from Form 1040 (federal echoes) and feeds Form
// 540 (lines 14/16/18), so it sits between them. Listing form-540 last
// also lets it pick up Schedule CA's values on the first pass instead of
// caching a fallback then ignoring the canonical value later.
const SCENARIO_FORM_IDS = ["form-8949", "form-1040", "schedule-ca", "form-540"];

let catalogPromise: Promise<Catalog> | null = null;
function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) {
    catalogPromise = loadFromFixtures(CATALOG_FILES);
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
  const [factRows, decisionRows, authUserRes] = await Promise.all([
    listFacts(supabase, { taxYear: year, limit: 500 }),
    listDecisions(supabase, { taxYear: year, limit: 500 }),
    // We pull the auth user once per case-state build so Thom can see the
    // signed-in email. He acknowledges it back to the user at doc-gen time
    // and records it as identity.email before rendering the 1040. We don't
    // throw if this fails — it's enriching info, not load-bearing for the
    // engine.
    supabase.auth.getUser().catch(() => null),
  ]);
  const authEmail = authUserRes?.data?.user?.email ?? null;

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

  const filingInfo = resolveFilingInfo({
    facts: facts.map((f) => ({ key: f.key, value: f.value, category: f.category })),
    decisions: decisions.map((d) => ({ decisionKey: d.decisionKey, decision: d.decision })),
  });
  const ctx: DerivationContext = {
    taxYear: year,
    facts: makeFactsView(facts),
    decisions: makeDecisionsView(decisions),
    // The typed-binding engine reads every input through ctx.filingInfo —
    // the resolver projects raw facts/decisions into a Form*FilingInfo
    // shape. Without this, every binding short-circuits to a "filingInfo
    // missing" block and forms render empty.
    filingInfo,
  };

  // Fixpoint evaluation across every form in the catalog. Cross-form
  // refs (540 line 13 → 1040 line 11b) resolve automatically — the
  // orchestrator iterates until results stop changing.
  const catalog = await getCatalog();
  const { forms } = evaluateAllForms(SCENARIO_FORM_IDS, ctx, catalog);
  const form1040 = forms.get("form-1040")!;
  const form540 = forms.get("form-540")!;

  const summaries: EvaluatedFormSummary[] = [
    summarizeForm(form1040),
    summarizeForm(form540),
  ];

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

  // Identity gaps surface as pendingFacts. We check the RESOLVED filingInfo
  // slot rather than raw fact presence — otherwise a fact recorded under the
  // right key but the wrong value shape (e.g. identity.phone written as an
  // object) passes the gate even though the resolver can't read it. Using
  // filingInfo means pendingFacts reflects exactly what the engine consumes.
  // identity.email is intentionally NOT in this list — it's a courtesy
  // field that Thom auto-fills from authEmail at doc-generation time.
  const REQUIRED_IDENTITY_SLOTS: Array<[string, () => unknown]> = [
    ["identity.name.first", () => filingInfo.taxpayerFirstName],
    ["identity.name.last", () => filingInfo.taxpayerLastName],
    ["identity.ssn", () => filingInfo.taxpayerSSN],
    ["identity.dob", () => filingInfo.taxpayerDateOfBirth],
    ["identity.address.street", () => filingInfo.homeAddressLine1],
    ["identity.address.city", () => filingInfo.homeAddressCity],
    ["identity.address.state", () => filingInfo.homeAddressState],
    ["identity.address.zip", () => filingInfo.homeAddressZip],
    ["identity.occupation", () => filingInfo.taxpayerOccupation],
    ["identity.phone", () => filingInfo.taxpayerPhone],
  ];
  for (const [key, get] of REQUIRED_IDENTITY_SLOTS) {
    if (!get()) pendingFacts.add(key);
  }

  // Money convenience fields — federal from 1040, state from 540.
  const money = {
    totalWages: numericField(form1040.fields, "form-1040.line.1z") ?? 0,
    federalAgi: numericField(form1040.fields, "form-1040.line.11") ?? 0,
    federalTaxableIncome: numericField(form1040.fields, "form-1040.line.15") ?? 0,
    federalTax: numericField(form1040.fields, "form-1040.line.24") ?? 0,
    federalWithholding: numericField(form1040.fields, "form-1040.line.25a") ?? 0,
    federalRefund: numericField(form1040.fields, "form-1040.line.34") ?? 0,
    federalOwed: numericField(form1040.fields, "form-1040.line.37") ?? 0,
    stateTax: numericField(form540.fields, "form-540.line.64_total_tax") ?? 0,
    stateWithholding:
      numericField(form540.fields, "form-540.line.71_ca_income_tax_withheld") ?? 0,
    stateRefund:
      numericField(form540.fields, "form-540.line.115_refund_or_no_amount_due") ?? 0,
    stateOwed: numericField(form540.fields, "form-540.line.111_amount_you_owe") ?? 0,
  };

  return {
    summaries,
    pendingDecisions: Array.from(pendingDecisions).sort(),
    pendingFacts: Array.from(pendingFacts).sort(),
    money,
    factCount: facts.length,
    decisionRows,
    authEmail,
    // The resolved filing info — handy for surfacing identity bits to the
    // web app (e.g. taxpayer first name for the header greeting) without
    // re-querying the DB.
    filingInfo,
    // Raw evaluated forms — for downstream rollups like the Filing Status
    // panel that need access to every field, not just blockers.
    evaluatedForms: [form1040, form540],
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
    /** Supabase login email — Thom records this as identity.email at doc-gen
     *  time after acknowledging it with the user. */
    authEmail: z.string().nullable(),
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
    const {
      summaries,
      pendingDecisions,
      pendingFacts,
      money,
      factCount,
      decisionRows,
      authEmail,
    } = await buildCaseState(supabase, input.year);

    return {
      forms: summaries,
      pendingDecisions,
      pendingFacts,
      money,
      factCount,
      authEmail,
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
