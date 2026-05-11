import { z } from "zod";
import { ok, blocked } from "../types.js";
import { rule } from "../engine.js";

// Signed sum of other fields in the same form (or any field already
// evaluated). `sign` is typically +1 or -1; coefficients other than ±1
// work but aren't expected in real tax-form math. Optional `floor` clamps
// the result; pass 0 to model "not less than zero" (e.g. 1040 line 15
// taxable income).
//
// This rule wasn't in the original PIPELINE.md plan — added during Phase A
// because intra-form arithmetic is unavoidable on real returns. Doc gets
// updated to mention it after Phase A lands.

export const combineFields = rule({
  name: "combineFields",
  paramsSchema: z.object({
    terms: z
      .array(
        z.object({
          fieldId: z.string(),
          sign: z.number(),
        }),
      )
      .min(1),
    floor: z.number().optional(),
    rationale: z.string().optional(),
  }),
  evaluate: (p, ctx) => {
    let sum = 0;
    const supporting: string[] = [];
    for (const t of p.terms) {
      const field = ctx.fieldResult(t.fieldId);
      if (!field) {
        return blocked(
          `Term ${t.fieldId} not evaluated yet — topo-sort gap.`,
        );
      }
      if (!field.ok) {
        return blocked(
          `Term ${t.fieldId} is blocked: ${field.reason}`,
          {
            decisionKey: field.missingDecisionKey,
            factKeys: field.missingFactKeys,
          },
        );
      }
      const v = Number(field.value);
      if (!Number.isFinite(v)) {
        return blocked(
          `Term ${t.fieldId} value is not numeric: ${String(field.value)}`,
        );
      }
      sum += t.sign * v;
      for (const k of field.supportingFactKeys) supporting.push(k);
    }
    if (typeof p.floor === "number" && sum < p.floor) {
      sum = p.floor;
    }
    const desc =
      p.rationale ??
      p.terms.map((t) => `${t.sign < 0 ? "−" : "+"} ${t.fieldId}`).join(" ");
    return ok(sum, desc, Array.from(new Set(supporting)));
  },
});
