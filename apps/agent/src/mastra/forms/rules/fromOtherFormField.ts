import { z } from "zod";
import { ok, blocked } from "../types.js";
import { rule } from "../engine.js";

// Cross-form reference. Reads another form's must-file result first:
//   - source mustFile blocked  → propagate the block
//   - source mustFile false    → return whenSourceNotRequired (fallback)
//   - source mustFile true     → read the source field's result
//
// Phase F is when this rule actually exercises — Phase A keeps Schedule D
// disabled, so the only line that would use this (1040 line 7) is bound to
// `constant 0` for now.

export const fromOtherFormField = rule({
  name: "fromOtherFormField",
  paramsSchema: z.object({
    sourceFormId: z.string(),
    sourceFieldId: z.string(),
    whenSourceNotRequired: z.unknown().optional(),
  }),
  evaluate: (p, ctx) => {
    const sourceMustFile = ctx.formMustFile(p.sourceFormId);
    if (!sourceMustFile) {
      return blocked(
        `Source form ${p.sourceFormId} has not been evaluated yet — likely a topo-sort gap.`,
      );
    }
    if (!sourceMustFile.ok) {
      return blocked(
        `Source form ${p.sourceFormId} mustFile is blocked: ${sourceMustFile.reason}`,
        {
          decisionKey: sourceMustFile.missingDecisionKey,
          factKeys: sourceMustFile.missingFactKeys,
        },
      );
    }
    if (sourceMustFile.value === false) {
      return ok(
        p.whenSourceNotRequired ?? 0,
        `Source form ${p.sourceFormId} not required: ${sourceMustFile.rationale}`,
        sourceMustFile.supportingFactKeys,
      );
    }
    const sourceField = ctx.fieldResult(p.sourceFieldId);
    if (!sourceField) {
      return blocked(
        `Source field ${p.sourceFieldId} not evaluated yet — topo-sort gap.`,
      );
    }
    if (!sourceField.ok) {
      return blocked(
        `Source field ${p.sourceFieldId} is blocked: ${sourceField.reason}`,
        {
          decisionKey: sourceField.missingDecisionKey,
          factKeys: sourceField.missingFactKeys,
        },
      );
    }
    return ok(
      sourceField.value,
      `From ${p.sourceFieldId}.`,
      sourceField.supportingFactKeys,
    );
  },
});
