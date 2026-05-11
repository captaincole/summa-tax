import { z } from "zod";
import { ok, blocked } from "../types.js";
import { rule } from "../engine.js";

// Progressive bracket math. Looks up the bracket table for the decision's
// value (e.g. filing_status → which bracket table to use), then evaluates
// the requested input field through the bands. Each band's `upTo` is the
// upper bound (exclusive of the next band's lower bound); use Infinity for
// the top band.

const BandSchema = z.object({
  upTo: z.number(),
  rate: z.number(),
});

export const bracketLookup = rule({
  name: "bracketLookup",
  paramsSchema: z.object({
    decisionKey: z.string(),
    inputFieldId: z.string(),
    brackets: z.record(z.string(), z.array(BandSchema).min(1)),
  }),
  evaluate: (p, ctx) => {
    const decision = ctx.decisions.get(p.decisionKey);
    if (!decision) {
      return blocked(`Need decision: ${p.decisionKey}`, {
        decisionKey: p.decisionKey,
      });
    }
    const key = String(decision.decision);
    const bands = p.brackets[key];
    if (!bands) {
      return blocked(
        `No bracket table for "${key}"; expected one of ${Object.keys(p.brackets).join(", ")}`,
        { decisionKey: p.decisionKey },
      );
    }
    const input = ctx.fieldResult(p.inputFieldId);
    if (!input) {
      return blocked(
        `Input field ${p.inputFieldId} not evaluated yet — topo-sort gap.`,
      );
    }
    if (!input.ok) {
      return blocked(
        `Input field ${p.inputFieldId} is blocked: ${input.reason}`,
        {
          decisionKey: input.missingDecisionKey,
          factKeys: input.missingFactKeys,
        },
      );
    }
    const amount = Number(input.value);
    if (!Number.isFinite(amount)) {
      return blocked(
        `Input field ${p.inputFieldId} value is not numeric: ${String(input.value)}`,
      );
    }
    if (amount <= 0) {
      return ok(
        0,
        `Input ${p.inputFieldId} is zero or negative; tax is zero.`,
        input.supportingFactKeys,
        p.decisionKey,
      );
    }
    let tax = 0;
    let prevUpTo = 0;
    for (const band of bands) {
      if (amount <= prevUpTo) break;
      const slice = Math.min(amount, band.upTo) - prevUpTo;
      tax += slice * band.rate;
      prevUpTo = band.upTo;
    }
    tax = Math.round(tax * 100) / 100;
    const supporting = [
      ...(decision.supportingFactKeys ?? []),
      ...input.supportingFactKeys,
    ];
    return ok(
      tax,
      `Bracket lookup for "${key}" at input=${amount} → ${tax}.`,
      Array.from(new Set(supporting)),
      p.decisionKey,
    );
  },
});
