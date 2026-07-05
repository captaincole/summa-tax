import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  evaluateScenario,
  type EngineFiling,
  type EvaluatedScenario,
} from "../engine";
import type { BaseFormField, EngineDerivation } from "../engine/types";
import { resolveOwnerFilingForYear } from "../db/filings";
import type { Scope } from "../db/appDb";
import { requireUserContext } from "./userContext";

// Live case state for Luca. Runs the four-form engine against the current
// fact + decision state and returns:
//   - per-form summaries (formId, mustFile result, line count, blockers)
//   - aggregated pending decisions (unique decisionKeys any form is blocked on)
//   - convenience money fields pulled from Form 1040 / CA 540 specific lines
//   - the most recent AI decisions for activity-feed display
//
// Luca calls this at the start of every turn to know:
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
  /** Engine-derivation provenance for the must-file determination. Lets the
   *  UI / sidecar surface WHY a form is being filed even when no AI
   *  decision was recorded (e.g. Schedule D fired off trade-fact presence). */
  mustFileDerivation: EngineDerivation | null;
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
// outside the Mastra tool surface. Thin wrapper over the engine's
// evaluateScenario — adds the case-state-specific summary/money/pendingFacts
// derivations on top of the raw engine output.
export async function buildCaseState(
  userId: string,
  year: number,
  authEmail: string | null = null,
) {
  const filingRow = await resolveOwnerFilingForYear(userId, year);
  const filing: EngineFiling = { id: filingRow.id, taxYear: filingRow.taxYear };
  const scope: Scope = { userId, filingId: filingRow.id };
  return buildCaseStateForScenario(
    await evaluateScenario(scope, filing, authEmail),
  );
}

// Variant that takes a filing identity directly — used by the CPA review
// route, where the caller is NOT the owner and the owner resolver would
// throw. Caller is responsible for verifying the user is allowed to read
// this filing (via filing_members membership) BEFORE invoking; this
// function trusts the inputs.
export async function buildCaseStateForFiling(
  scope: Scope,
  taxYear: number,
  authEmail: string | null = null,
) {
  const filing: EngineFiling = { id: scope.filingId, taxYear };
  return buildCaseStateForScenario(
    await evaluateScenario(scope, filing, authEmail),
  );
}

export function buildCaseStateForScenario(scenario: EvaluatedScenario) {
  const { forms, facts, decisions, filingInfo, authEmail } = scenario;
  const form1040 = forms.get("form-1040")!;
  const form540 = forms.get("form-540")!;

  const summaries: EvaluatedFormSummary[] = [
    summarizeForm(form1040),
    summarizeForm(form540),
  ];

  // Aggregate unique pending decisions / facts across all blockers (incl.
  // mustFile blockers). Luca asks the user about these.
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
  // field that Luca auto-fills from authEmail at doc-generation time.
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
    decisionRows: decisions,
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
  mustFileDerivation?: EngineDerivation;
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
    mustFileDerivation: form.mustFileDerivation ?? null,
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
    /** Account email — Luca records this as identity.email at doc-gen
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
  execute: async (_input, context) => {
    const { scope, filingId, taxYear, authEmail: jwtEmail } =
      await requireUserContext(context);
    // requireUserContext already resolved the active filing — skip the extra
    // resolveOwnerFilingForYear that buildCaseState would do.
    const scenario = await evaluateScenario(scope, { id: filingId, taxYear }, jwtEmail);
    const {
      summaries,
      pendingDecisions,
      pendingFacts,
      money,
      factCount,
      decisionRows,
      authEmail,
    } = buildCaseStateForScenario(scenario);

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
