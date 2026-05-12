import { z } from "zod";
import { ok, blocked } from "../types.js";
import { rule } from "../engine.js";

// Multi-select binding driven by a single decision. The rule reads the
// decision and the catalog form field's `options`, returns the subset of
// option values that match the decision (always 0 or 1 today; ready for
// true multi-value decisions if those land later).
//
// Example: filing_status decision = "single" + options [single, mfj, mfs,
// hoh, qss] → ["single"]. Renderer iterates the returned values and checks
// the corresponding PDF widget for each (each option carries its own
// pdfWidgetName in the catalog).

export const decisionIfEquals = rule({
  name: "decisionIfEquals",
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
    const options = ctx.field?.options;
    if (!options || options.length === 0) {
      return blocked(
        `decisionIfEquals: field "${ctx.field?.fieldId ?? "?"}" has no options. ` +
          `Multi-select fields must declare options in the catalog.`,
      );
    }
    const decisionValue = decision.decision;
    const selected = options
      .filter((o) => o.value === decisionValue)
      .map((o) => o.value);
    return ok(
      selected,
      decision.rationale,
      decision.supportingFactKeys,
      p.decisionKey,
    );
  },
});
