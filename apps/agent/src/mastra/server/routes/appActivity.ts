import type { SupabaseClient } from "@supabase/supabase-js";
import { registerApiRoute } from "@mastra/core/server";
import { listDecisions } from "../../db/aiDecisions";
import { listFacts } from "../../db/taxFacts";
import { DEMO_TAX_YEAR } from "../demoSession";
import { REQUEST_CONTEXT_KEYS } from "../userSupabaseMiddleware";

// Merged activity feed for the right rail — tax_facts + ai_decisions newest-
// first, formatted for the UI. Append-only across both tables, so no dedup;
// the case engine handles latest-value collapsing elsewhere.
//
// Both reads run through the per-request user-scoped Supabase client, so RLS
// scopes the data to the authenticated user — no manual user_id filtering.
export const appActivityRoute = registerApiRoute("/app/activity", {
  method: "GET",
  handler: async (c) => {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;
    const requestContext = c.get("requestContext");
    const supabase = requestContext?.get(REQUEST_CONTEXT_KEYS.userSupabase) as
      | SupabaseClient
      | undefined;
    if (!supabase) return c.json({ error: "unauthorized" }, 401);

    const [facts, decisions] = await Promise.all([
      listFacts(supabase, { taxYear: DEMO_TAX_YEAR, limit }),
      listDecisions(supabase, { taxYear: DEMO_TAX_YEAR, limit }),
    ]);

    const factItems = facts.map((f) => ({
      kind: "fact" as const,
      id: f.id,
      createdAt: f.createdAt,
      title: f.key,
      category: f.category,
      value: f.value,
      sourceNote: f.sourceNote,
    }));

    const decisionItems = decisions.map((d) => ({
      kind: "decision" as const,
      id: d.id,
      createdAt: d.createdAt,
      title: d.decisionKey,
      value: d.decision,
      rationale: d.rationale,
      supportingFactKeys: d.supportingFactKeys,
      confidence: d.confidence,
      verdict: d.verdict,
      verdictReason: d.verdictReason,
      sourceNote: d.sourceNote,
    }));

    const items = [...factItems, ...decisionItems]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);

    return c.json({ items });
  },
});
