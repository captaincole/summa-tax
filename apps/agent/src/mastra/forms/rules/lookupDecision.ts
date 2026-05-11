import { z } from "zod";
import { ok, blocked } from "../types.js";
import { rule } from "../engine.js";

// Pass-through read of a decision. Returns whatever the decision recorded
// (boolean, string, number, …). Used both for selectable fields (filing
// status, residency) and for must-file bindings (where the engine coerces
// the value to boolean via decision === true).

export const lookupDecision = rule({
  name: "lookupDecision",
  paramsSchema: z.object({
    decisionKey: z.string(),
  }),
  evaluate: (p, ctx) => {
    const decision = ctx.decisions.get(p.decisionKey);
    if (!decision) {
      return blocked(`Need decision: ${p.decisionKey}`, {
        decisionKey: p.decisionKey,
      });
    }
    return ok(
      decision.decision,
      decision.rationale,
      decision.supportingFactKeys,
      p.decisionKey,
    );
  },
});
