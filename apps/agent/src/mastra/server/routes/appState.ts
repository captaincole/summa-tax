import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { listFactsByKeys } from "../../db/taxFacts";
import { listDocuments, type UserDocumentRow } from "../../db/userDocuments";
import { buildCaseState } from "../../tools/caseState";
import { thom } from "../../agents/thom";
import {
  thomWorkingMemorySchema,
  type PlanItem,
} from "../../agents/thom.workingMemory";
import { DEMO_TAX_YEAR, DEMO_THREAD_ID } from "../demoSession";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

async function readThomPlan(): Promise<PlanItem[]> {
  // Read working memory off Thom's thread-scoped Memory. Returns [] when:
  //   - the thread has never had a turn (no working memory row yet)
  //   - the JSON parse fails (shouldn't happen since Mastra writes via the
  //     same schema, but defensive)
  //   - the schema validation fails (e.g. a field rename we haven't migrated)
  // We never want a malformed plan to take down the whole /app/state response.
  try {
    const memory = await thom.getMemory();
    if (!memory) return [];
    const raw = await memory.getWorkingMemory({ threadId: DEMO_THREAD_ID });
    if (!raw) return [];
    const parsed = thomWorkingMemorySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return parsed.data.plan ?? [];
  } catch {
    return [];
  }
}

// Live status for the right rail — open asks, progress, money summary, and
// links to the most recent draft of each form. Document links resolve through
// /documents/{uuid}; we look up the most recent draft per formId via the
// user_documents metadata table (RLS scopes to the current user).
export const appStateRoute = registerApiRoute("/app/state", {
  method: "GET",
  handler: async (c) => {
    const requestContext = c.get("requestContext");
    const supabase = requestContext?.get(REQUEST_CONTEXT_KEYS.userSupabase) as
      | SupabaseClient
      | undefined;
    const userId = requestContext?.get(MASTRA_RESOURCE_ID_KEY) as
      | string
      | undefined;
    if (!supabase || !userId) return c.json({ error: "unauthorized" }, 401);

    const [result, plan] = await Promise.all([
      buildCaseState(supabase, DEMO_TAX_YEAR),
      readThomPlan(),
    ]);

    // Most recent draft per formId. listDocuments returns newest-first, so we
    // walk once and keep the first hit per formId — that's "the most recent
    // version the user has." Each generate-tax-documents run inserts new rows;
    // older versions remain reachable by their direct /documents/{uuid} URLs
    // in chat history.
    const drafts = await listDocuments(supabase, {
      category: "drafts",
      taxYear: DEMO_TAX_YEAR,
    });
    const latestByForm = new Map<string, UserDocumentRow>();
    for (const d of drafts) {
      const formId = (d.metadata as { formId?: string } | null)?.formId;
      if (formId && !latestByForm.has(formId)) latestByForm.set(formId, d);
    }
    const urlFor = (formId: string) => {
      const d = latestByForm.get(formId);
      return d ? `/documents/${d.id}` : null;
    };

    // Pull the first-name fact for the header greeting.
    const nameRows = await listFactsByKeys(supabase, DEMO_TAX_YEAR, [
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
    const totalForms = result.summaries.length;
    const computedForms = result.summaries.filter(
      (f) =>
        f.mustFile.ok &&
        (f.mustFile.value === false || f.blockedFieldCount === 0),
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
      decisionCount: result.decisionRows.length,
      draftUrl: urlFor("1040"),
      form8949Url: urlFor("8949"),
      scheduleDUrl: urlFor("schedule-d"),
      form540Url: urlFor("540"),
      sidecarUrl: urlFor("sidecar"),
      taxpayerFirstName,
      plan,
    });
  },
});
