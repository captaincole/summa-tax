import { z } from "zod";
import { ok, blocked } from "../types.js";
import { rule } from "../engine.js";

export const lookupFact = rule({
  name: "lookupFact",
  paramsSchema: z.object({
    factKey: z.string(),
  }),
  evaluate: (p, ctx) => {
    const fact = ctx.facts.get(p.factKey);
    if (!fact) {
      return blocked(`Need fact: ${p.factKey}`, { factKeys: [p.factKey] });
    }
    return ok(fact.value, `From fact ${p.factKey}.`, [p.factKey]);
  },
});
