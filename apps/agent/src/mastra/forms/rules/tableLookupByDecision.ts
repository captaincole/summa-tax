import { z } from "zod";
import { ok, blocked } from "../types.js";
import { rule } from "../engine.js";

export const tableLookupByDecision = rule({
  name: "tableLookupByDecision",
  paramsSchema: z.object({
    decisionKey: z.string(),
    table: z.record(z.string(), z.number()),
  }),
  evaluate: (p, ctx) => {
    const decision = ctx.decisions.get(p.decisionKey);
    if (!decision) {
      return blocked(`Need decision: ${p.decisionKey}`, {
        decisionKey: p.decisionKey,
      });
    }
    const key = String(decision.decision);
    const value = p.table[key];
    if (value === undefined) {
      return blocked(
        `No table entry for "${key}"; expected one of ${Object.keys(p.table).join(", ")}`,
        { decisionKey: p.decisionKey },
      );
    }
    return ok(
      value,
      `Table lookup at "${key}" → ${value}.`,
      decision.supportingFactKeys,
      p.decisionKey,
    );
  },
});
