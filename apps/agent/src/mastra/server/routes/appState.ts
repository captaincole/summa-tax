import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { registerApiRoute } from "@mastra/core/server";
import { getActiveTaxpayerId, listFactsByKeys } from "../../db/taxFacts";
import { DRAFTS_DIR } from "../../fs/draftsDir";
import { getCaseState } from "../../tools/caseState";
import { DEMO_TAXPAYER_ID, DEMO_TAX_YEAR } from "../demoSession";

// Shape returned by the get-case-state tool. Mastra's createTool() doesn't
// publicly type the execute() return, so we re-state the shape here for the
// inline tool call below. Keep in sync with apps/agent/src/mastra/tools/caseState.ts.
interface CaseStateResult {
  forms: Array<{
    formId: string;
    mustFile: { ok: boolean; value?: boolean };
    blockedLineCount: number;
    blockers: Array<{
      missingDecisionKey: string | null;
      missingFactKeys: string[] | null;
    }>;
  }>;
  pendingDecisions: string[];
  pendingFacts: string[];
  money: {
    totalWages: number;
    federalAgi: number;
    federalTaxableIncome: number;
    federalTax: number;
    federalWithholding: number;
    federalRefund: number;
    federalOwed: number;
    stateTax: number;
    stateWithholding: number;
    stateRefund: number;
    stateOwed: number;
  };
  factCount: number;
  aiDecisions: unknown[];
}

interface CaseStateExecutor {
  execute: (input: { taxpayerId: string; year: number }) => Promise<CaseStateResult>;
}

// Live status for the right rail — open asks, progress, draft URL, money summary.
//
// Thom picks his own taxpayer_id (see his prompt) so the server has to discover
// the active session at request time. Falls back to the demo constant when the
// DB is empty so first-turn renders still work.
export const appStateRoute = registerApiRoute("/app/state", {
  method: "GET",
  handler: async (c) => {
    const activeId =
      (await getActiveTaxpayerId(DEMO_TAX_YEAR)) ?? DEMO_TAXPAYER_ID;

    const result = await (getCaseState as unknown as CaseStateExecutor).execute({
      taxpayerId: activeId,
      year: DEMO_TAX_YEAR,
    });

    // PDF URL existence checks. Returns the public path when the file exists
    // on disk, null otherwise — UI uses this to show/hide the document links.
    const draftFilename = `1040-${activeId}-${DEMO_TAX_YEAR}.pdf`;
    const draftUrl = existsSync(resolve(DRAFTS_DIR, draftFilename))
      ? `/drafts/${draftFilename}`
      : null;

    const form8949Filename = `8949-${activeId}-${DEMO_TAX_YEAR}.pdf`;
    const form8949Url = existsSync(resolve(DRAFTS_DIR, form8949Filename))
      ? `/drafts/${form8949Filename}`
      : null;

    const scheduleDFilename = `schedule-d-${activeId}-${DEMO_TAX_YEAR}.pdf`;
    const scheduleDUrl = existsSync(resolve(DRAFTS_DIR, scheduleDFilename))
      ? `/drafts/${scheduleDFilename}`
      : null;

    const form540Filename = `540-${activeId}-${DEMO_TAX_YEAR}.pdf`;
    const form540Url = existsSync(resolve(DRAFTS_DIR, form540Filename))
      ? `/drafts/${form540Filename}`
      : null;

    const sidecarFilename = `forms-${activeId}-${DEMO_TAX_YEAR}.json`;
    const sidecarUrl = existsSync(resolve(DRAFTS_DIR, sidecarFilename))
      ? `/drafts/${sidecarFilename}`
      : null;

    // Pull the first-name fact for the header greeting.
    const nameRows = await listFactsByKeys(activeId, DEMO_TAX_YEAR, [
      "identity.name.first",
    ]);
    const taxpayerFirstName =
      nameRows.length > 0 && typeof nameRows[0].value === "string"
        ? (nameRows[0].value as string)
        : null;

    // Adapter: bridge new caseState shape back to the legacy fields the
    // current Layout/Activity UI consumes. When we update the UI to read
    // forms[] directly, this collapses.
    const openAsks = result.pendingDecisions.map((d) => ({
      factKey: d,
      prompt: `Need decision: ${d}`,
      origin: "form-engine",
      stage: "decisions",
    }));
    const totalForms = result.forms.length;
    const computedForms = result.forms.filter(
      (f) =>
        f.mustFile.ok &&
        (f.mustFile.value === false || f.blockedLineCount === 0),
    ).length;
    const overallPct =
      totalForms > 0 ? Math.round((computedForms / totalForms) * 100) : 0;
    const progress = {
      intakePct: overallPct,
      scopingPct: overallPct,
      docsPct: overallPct,
      overallPct,
    };
    const refundOrBalance =
      result.money.federalRefund > 0
        ? { direction: "refund", amount: result.money.federalRefund }
        : result.money.federalOwed > 0
          ? { direction: "balance_due", amount: result.money.federalOwed }
          : null;
    const moneyLegacy = {
      totalWages: result.money.totalWages,
      agi: result.money.federalAgi,
      taxableIncome: result.money.federalTaxableIncome,
      federalTaxOwed: result.money.federalTax,
      federalWithholding: result.money.federalWithholding,
      refundOrBalance,
    };

    return c.json({
      withinMvp: true,
      mvpViolations: [] as string[],
      openAsks,
      progress,
      money: moneyLegacy,
      factCount: result.factCount,
      decisionCount: result.aiDecisions.length,
      draftUrl,
      form8949Url,
      scheduleDUrl,
      form540Url,
      sidecarUrl,
      taxpayerFirstName,
    });
  },
});
