import { registerApiRoute } from "@mastra/core/server";
import { listDecisions } from "../../db/aiDecisions";
import { getActiveTaxpayerId, listFacts } from "../../db/taxFacts";
import { DEMO_TAXPAYER_ID, DEMO_TAX_YEAR } from "../demoSession";

// Merged activity feed for the right rail — tax_facts + ai_decisions newest-
// first, formatted for the UI. Append-only across both tables, so no dedup;
// the case engine handles latest-value collapsing elsewhere.
export const appActivityRoute = registerApiRoute("/app/activity", {
  method: "GET",
  handler: async (c) => {
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50;

    const activeId =
      (await getActiveTaxpayerId(DEMO_TAX_YEAR)) ?? DEMO_TAXPAYER_ID;

    const [facts, decisions] = await Promise.all([
      listFacts({ taxpayerId: activeId, year: DEMO_TAX_YEAR, limit }),
      listDecisions({ taxpayerId: activeId, year: DEMO_TAX_YEAR, limit }),
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
