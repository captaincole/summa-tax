import { z } from "zod";
import { ok, blocked } from "../types.js";
import { rule } from "../engine.js";

export const lookupFact = rule({
  name: "lookupFact",
  paramsSchema: z.object({
    factKey: z.string(),
    /**
     * When true, a missing fact returns ok("") instead of blocking. Use for
     * sub-facts that are genuinely optional (e.g. identity.address.apt — most
     * users don't have one, and we don't want Thom asking).
     */
    optional: z.boolean().optional(),
  }),
  evaluate: (p, ctx) => {
    const fact = ctx.facts.get(p.factKey);
    if (!fact) {
      if (p.optional) {
        return ok("", `Optional fact ${p.factKey} not provided.`, []);
      }
      return blocked(`Need fact: ${p.factKey}`, { factKeys: [p.factKey] });
    }
    return ok(fact.value, `From fact ${p.factKey}.`, [p.factKey]);
  },
});
