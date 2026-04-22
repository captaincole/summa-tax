import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listFacts } from "../db/taxFacts";
import { listDecisions } from "../db/aiDecisions";
import { computeCaseState } from "../../case/engine";
import type { FactMap } from "../../case/types";
import { alexDerivations } from "../../case/derivations";
import { artifactScopeDerivations } from "../../tax/artifacts";

// Read all facts for the taxpayer from the DB, run the full derivation
// graph, and return a digestible summary of the current case state.
// Thom calls this at the start of every turn to see what's known, what's
// missing, and what to ask next.
async function buildCaseState(taxpayerId: string, year: number) {
  const [rows, decisionRows] = await Promise.all([
    listFacts({ taxpayerId, year, limit: 500 }),
    listDecisions({ taxpayerId, year, limit: 500 }),
  ]);

  // Build fact map from DB rows. "Supersession" semantics: we only keep
  // the most recent value for each fact key (listFacts returns DESC by
  // created_at, so the first occurrence wins).
  const factMap: FactMap = {};
  for (const row of rows) {
    if (!(row.key in factMap)) {
      factMap[row.key] = row.value;
    }
  }

  // Merge AI decisions into the fact map — a decision's decisionKey
  // (e.g. "decisions.ca_residency") becomes a fact-like input so
  // downstream derivations can consume it. Same supersession rule:
  // most recent wins.
  for (const d of decisionRows) {
    if (!(d.decisionKey in factMap)) {
      factMap[d.decisionKey] = d.decision;
    }
  }

  // Inject tax_year from the call parameter if the taxpayer hasn't
  // explicitly recorded one yet. This keeps early-turn derivations
  // useful even before Thom has asked "what tax year?".
  if (factMap["tax_year"] === undefined) {
    factMap["tax_year"] = year;
  }

  const allDerivations = [...artifactScopeDerivations, ...alexDerivations];
  const state = computeCaseState(factMap, allDerivations);
  return { state, decisionRows };
}

export const getCaseState = createTool({
  id: "get-case-state",
  description:
    "Returns the live case state for a taxpayer. Includes: MVP scope check (withinMvp + violations — decline if false), scoping statuses per in-scope artifact (Form 1040, CA 540, W-2), the open-asks list Thom should pick from next, progress percentages, the draft 1040 with populated lines, all money derivations (wages, AGI, taxable income, federal tax, refund/balance), and key decisions (itemize vs standard, saver's credit). Call at the start of every turn before deciding what to say or ask.",
  inputSchema: z.object({
    taxpayerId: z.string().describe("Stable id for the taxpayer"),
    year: z.number().int().describe("Tax year (e.g. 2025)"),
  }),
  outputSchema: z.object({
    withinMvp: z.boolean(),
    mvpViolations: z.array(z.string()),
    scope: z.record(z.string(), z.any()),
    openAsks: z.array(
      z.object({
        factKey: z.string(),
        prompt: z.string(),
        origin: z.string(),
        stage: z.string(),
      }),
    ),
    progress: z.object({
      intakePct: z.number(),
      scopingPct: z.number(),
      docsPct: z.number(),
      overallPct: z.number(),
    }),
    money: z.object({
      totalWages: z.number(),
      agi: z.number(),
      taxableIncome: z.number(),
      federalTaxOwed: z.number(),
      federalWithholding: z.number(),
      refundOrBalance: z.any(),
    }),
    decisions: z.object({
      itemizeVsStandard: z.any(),
      saversCredit: z.any(),
    }),
    draft1040: z.any(),
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
  execute: async (input) => {
    const { state, decisionRows } = await buildCaseState(
      input.taxpayerId,
      input.year,
    );
    const mvp = state.derivations["mvp.scope_check"] as {
      withinMvp: boolean;
      violations: string[];
    };

    return {
      withinMvp: mvp?.withinMvp ?? true,
      mvpViolations: mvp?.violations ?? [],
      scope: {
        form1040: state.derivations["scope.form-1040"],
        ca540: state.derivations["scope.ca-form-540"],
        w2Source: state.derivations["scope.w2-source"],
      },
      openAsks: (state.derivations["case.open_asks"] as {
        factKey: string;
        prompt: string;
        origin: string;
        stage: string;
      }[]) ?? [],
      progress: state.derivations["case.progress"] as {
        intakePct: number;
        scopingPct: number;
        docsPct: number;
        overallPct: number;
      },
      money: {
        totalWages: Number(state.derivations["money.total_wages"] ?? 0),
        agi: Number(state.derivations["money.agi"] ?? 0),
        taxableIncome: Number(state.derivations["money.taxable_income"] ?? 0),
        federalTaxOwed: Number(state.derivations["money.federal_tax_owed"] ?? 0),
        federalWithholding: Number(
          state.derivations["money.total_federal_withholding"] ?? 0,
        ),
        refundOrBalance: state.derivations["money.refund_or_balance_due"],
      },
      decisions: {
        itemizeVsStandard: state.derivations["decisions.itemize_vs_standard"],
        saversCredit: state.derivations["credits.savers_credit"],
      },
      draft1040: state.derivations["forms.draft_1040"],
      factCount: Object.keys(state.facts).length,
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
