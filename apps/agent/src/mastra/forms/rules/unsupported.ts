import { z } from "zod";
import { unsupported as unsupportedResult } from "../types.js";
import { rule } from "../engine.js";

// Mark a field as a known engine gap — we don't compute it yet because
// there's no example input/output scenario for it. Different from
// `constant 0`: constant says "we KNOW this is zero"; unsupported says
// "we don't model this field at all yet, please don't ask the user
// questions about it."
//
// caseState filters unsupported results out of pendingDecisions /
// pendingFacts so Thom stays focused on facts the taxpayer actually
// needs to provide. The PDF renderer can skip the field or fill with a
// type-appropriate default; downstream sums (`fromFields`) treat
// unsupported terms as 0 to avoid cascading the gap.

export const unsupported = rule({
  name: "unsupported",
  paramsSchema: z.object({
    reason: z.string(),
  }),
  evaluate: (p) => unsupportedResult(p.reason),
});
