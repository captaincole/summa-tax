import type { SupabaseClient } from "@supabase/supabase-js";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listFacts, type TaxFactRow } from "../db/taxFacts";
import { listDecisions, type AIDecisionRow } from "../db/aiDecisions";
import {
  makeDecisionsView,
  makeFactsView,
  type BaseLine,
  type DerivationContext,
} from "../forms/types";
import { evaluateForm8949 } from "../forms/form8949";
import { evaluateScheduleD } from "../forms/scheduleD";
import { evaluateForm1040 } from "../forms/form1040";
import { evaluateForm540 } from "../forms/form540";
import { requireUserContext } from "./userContext";

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
  lineCount: number;
  blockedLineCount: number;
  blockers: Array<{
    lineId: string;
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

  // Run forms in dependency order.
  const form8949 = evaluateForm8949(ctx);
  const scheduleD = evaluateScheduleD(ctx, form8949);
  const form1040 = evaluateForm1040(ctx, scheduleD);
  const form540 = evaluateForm540(ctx, form1040);

  const summaries: EvaluatedFormSummary[] = [
    summarizeForm(form8949),
    summarizeForm(scheduleD),
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

  // Money convenience fields — read specific 1040 / CA 540 lines if present.
  const money = {
    totalWages: lineValue(form1040.lines, "1z") ?? 0,
    federalAgi: lineValue(form1040.lines, "11") ?? 0,
    federalTaxableIncome: lineValue(form1040.lines, "15") ?? 0,
    federalTax: lineValue(form1040.lines, "24") ?? 0,
    federalWithholding: lineValue(form1040.lines, "25a") ?? 0,
    federalRefund: lineValue(form1040.lines, "34") ?? 0,
    federalOwed: lineValue(form1040.lines, "37") ?? 0,
    stateTax: lineValue(form540.lines, "64") ?? 0,
    stateWithholding: lineValue(form540.lines, "71") ?? 0,
    stateRefund: lineValue(form540.lines, "97") ?? 0,
    stateOwed: lineValue(form540.lines, "100") ?? 0,
  };

  return {
    summaries,
    pendingDecisions: Array.from(pendingDecisions).sort(),
    pendingFacts: Array.from(pendingFacts).sort(),
    money,
    factCount: facts.length,
    decisionRows,
  };
}

function summarizeForm(form: {
  formId: string;
  jurisdiction: string;
  title: string;
  mustFile:
    | { ok: true; value: boolean; rationale: string; supportingFactKeys: string[]; decisionKey?: string }
    | { ok: false; reason: string; missingDecisionKey?: string; missingFactKeys?: string[] };
  lines: Array<{
    lineId: string;
    result:
      | { ok: true; value: unknown; rationale: string; supportingFactKeys: string[]; decisionKey?: string }
      | { ok: false; reason: string; missingDecisionKey?: string; missingFactKeys?: string[] };
  }>;
}): EvaluatedFormSummary {
  const blockers = form.lines
    .filter((l) => !l.result.ok)
    .map((l) => {
      const r = l.result as Extract<typeof l.result, { ok: false }>;
      return {
        lineId: l.lineId,
        reason: r.reason,
        missingDecisionKey: r.missingDecisionKey ?? null,
        missingFactKeys: r.missingFactKeys ?? null,
      };
    });
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
    lineCount: form.lines.length,
    blockedLineCount: blockers.length,
    blockers,
  };
}

function lineValue<L extends BaseLine & { lineNumber: string }>(
  lines: readonly L[],
  number: string,
): number | null {
  const line = lines.find((l) => l.lineNumber === number);
  if (!line || !line.result.ok) return null;
  const v = line.result.value;
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
