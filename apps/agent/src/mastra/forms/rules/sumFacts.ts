import { z } from "zod";
import { ok } from "../types.js";
import { rule } from "../engine.js";

export const sumFacts = rule({
  name: "sumFacts",
  paramsSchema: z.object({
    category: z.string(),
    keyPrefix: z.string().optional(),
    fieldPath: z.string(),
  }),
  evaluate: (p, ctx) => {
    const rows = ctx.facts
      .byCategory(p.category)
      .filter((r) => !p.keyPrefix || r.key.startsWith(p.keyPrefix));
    let total = 0;
    const supportingFactKeys: string[] = [];
    let matched = 0;
    for (const row of rows) {
      const v = getPath(row.value, p.fieldPath);
      if (typeof v === "number" && Number.isFinite(v)) {
        total += v;
        supportingFactKeys.push(row.key);
        matched++;
      }
    }
    return ok(
      total,
      `Sum of ${p.fieldPath} across ${matched} ${p.category} fact(s).`,
      supportingFactKeys,
    );
  },
});

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}
