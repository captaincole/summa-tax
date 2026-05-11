import { z } from "zod";
import { ok, blocked } from "../types.js";
import { rule } from "../engine.js";

// Signed sum of values pulled from one or more form fields. Handles both
// intra-form arithmetic (e.g. 1040 line 11 = line 9 − line 10) and
// cross-form references (e.g. 1040 line 7 from Schedule D line 16) — the
// only difference is the term's `formId`. Each term can opt into a
// not-required fallback for when its source form's mustFile is false.
//
// Replaces the prior `combineFields` (intra-form) and `fromOtherFormField`
// (single cross-form term) rules. The split was illusory: both were
// reading from previously-evaluated fields and summing with signs.

export const fromFields = rule({
  name: "fromFields",
  paramsSchema: z.object({
    terms: z
      .array(
        z.object({
          // Full fieldId from the catalog (e.g. "form-1040.line.9"). The
          // source form is derived from the first segment — by convention,
          // every fieldId starts with its parent formId.
          fieldId: z.string(),
          sign: z.number(),
          // When the term's source form's mustFile is `false`, contribute
          // this value instead of blocking. Set to 0 on cross-form refs
          // that should zero out when the source form doesn't apply
          // (e.g. 1040 line 7 when Schedule D isn't required). Omit on
          // intra-form refs — the current form's mustFile is always true
          // by the time we're evaluating fields.
          whenSourceNotRequired: z.unknown().optional(),
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
      // fieldId convention: "<formId>.<section>.<key>". Split on first dot
      // to recover the source formId for the mustFile check.
      const dotIdx = t.fieldId.indexOf(".");
      const sourceFormId =
        dotIdx > 0 ? t.fieldId.slice(0, dotIdx) : t.fieldId;

      const sourceMustFile = ctx.formMustFile(sourceFormId);
      if (!sourceMustFile) {
        return blocked(
          `Source form ${sourceFormId} (from fieldId ${t.fieldId}) has not been evaluated yet — likely a topo-sort gap.`,
        );
      }
      if (!sourceMustFile.ok) {
        return blocked(
          `Source form ${sourceFormId} mustFile is blocked: ${sourceMustFile.reason}`,
          {
            decisionKey: sourceMustFile.missingDecisionKey,
            factKeys: sourceMustFile.missingFactKeys,
          },
        );
      }

      // Source form exists but isn't required — use the per-term fallback
      // when provided; otherwise block.
      if (sourceMustFile.value === false) {
        if (t.whenSourceNotRequired === undefined) {
          return blocked(
            `Source form ${sourceFormId} not required and term has no whenSourceNotRequired fallback.`,
          );
        }
        const fallback = Number(t.whenSourceNotRequired);
        if (!Number.isFinite(fallback)) {
          return blocked(
            `Term ${t.fieldId} fallback is not numeric: ${String(t.whenSourceNotRequired)}`,
          );
        }
        sum += t.sign * fallback;
        for (const k of sourceMustFile.supportingFactKeys) supporting.push(k);
        continue;
      }

      const field = ctx.fieldResult(t.fieldId);
      if (!field) {
        return blocked(
          `Term ${t.fieldId} not evaluated yet — topo-sort gap.`,
        );
      }
      // Unsupported terms contribute 0 so downstream sums keep computing.
      // The gap is logged via the upstream field's own unsupported result;
      // we don't propagate it here.
      if (!field.ok && field.unsupported) {
        continue;
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
