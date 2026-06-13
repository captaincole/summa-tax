import type { SupabaseClient } from "@supabase/supabase-js";
import { MASTRA_RESOURCE_ID_KEY } from "@mastra/core/request-context";
import { registerApiRoute } from "@mastra/core/server";
import { listDocuments, type UserDocumentRow } from "../../db/userDocuments";
import { buildCaseState } from "../../tools/caseState";
import { luca } from "../../agents/luca";
import {
  lucaWorkingMemorySchema,
  type PlanItem,
} from "../../agents/luca.workingMemory";
import { DEMO_TAX_YEAR } from "../demoSession";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";
import { resolveOwnerFilingForYear } from "../../db/filings";

// Must match apps/web/lib/returns.ts:threadIdFor — no shared package yet.
function threadIdFor(userId: string, returnId: string | number): string {
  return `${userId}::${returnId}`;
}

async function readLucaPlan(threadId: string): Promise<PlanItem[]> {
  // Read working memory off Luca's thread-scoped Memory. Returns [] when:
  //   - the thread has never had a turn (no working memory row yet)
  //   - the JSON parse fails (shouldn't happen since Mastra writes via the
  //     same schema, but defensive)
  //   - the schema validation fails (e.g. a field rename we haven't migrated)
  // We never want a malformed plan to take down the whole /app/state response.
  try {
    const memory = await luca.getMemory();
    if (!memory) return [];
    const raw = await memory.getWorkingMemory({ threadId });
    if (!raw) return [];
    const parsed = lucaWorkingMemorySchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return parsed.data.plan ?? [];
  } catch {
    return [];
  }
}

// Live case state for the web app. Pass-through over buildCaseState plus
// document URLs and Luca's plan. The previous handler adapted the engine
// output to a legacy shape (openAsks / progress / draftUrl / 8949Url /
// scheduleDUrl) that the new engine doesn't speak. The web app reads the
// engine's native shape directly now — anything the engine doesn't compute
// (Form 8949, Schedule D) is simply absent rather than rendered as null.
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

    const [caseState, plan, drafts] = await Promise.all([
      buildCaseState(supabase, DEMO_TAX_YEAR),
      readLucaPlan(threadIdFor(userId, DEMO_TAX_YEAR)),
      listDocuments(supabase, { category: "drafts", taxYear: DEMO_TAX_YEAR }),
    ]);

    // Most recent draft per formId. listDocuments returns newest-first, so
    // first-seen-wins gives us the latest version per form. Older versions
    // remain reachable by their direct /documents/{uuid} URLs in chat history.
    const latestByForm = new Map<string, UserDocumentRow>();
    for (const d of drafts) {
      const formId = (d.metadata as { formId?: string } | null)?.formId;
      if (formId && !latestByForm.has(formId)) latestByForm.set(formId, d);
    }
    const urlFor = (formId: string) => {
      const d = latestByForm.get(formId);
      return d ? `/documents/${d.id}` : null;
    };

    return c.json({
      taxpayerFirstName: caseState.filingInfo.taxpayerFirstName ?? null,
      authEmail: caseState.authEmail,
      plan,
      factCount: caseState.factCount,
      decisionCount: caseState.decisionRows.length,
      pendingDecisions: caseState.pendingDecisions,
      pendingFacts: caseState.pendingFacts,
      forms: caseState.summaries,
      money: caseState.money,
      documents: {
        form1040Url: urlFor("1040"),
        form540Url: urlFor("540"),
        sidecarUrl: urlFor("sidecar"),
      },
    });
  },
});
