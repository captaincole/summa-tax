import { z } from "zod";
import { ok, blocked, unsupported } from "../types.js";
import { rule } from "../engine.js";
import { lookupTax, type FilingStatus } from "../data/taxTable.js";

// IRS Tax Table lookup — Form 1040 line 16 for taxable income under
// $100,000. The IRS instructions REQUIRE the table for sub-$100k incomes
// because each row's tax is computed at the midpoint of its $50 bracket;
// applying the bracket formula to the raw income produces values that are
// close but not identical (often off by single-digit dollars).
//
// For income ≥ $100k the instructions switch to the Tax Computation
// Worksheet (a piecewise-linear schedule). That path is unsupported for
// now; the rule returns `unsupported` and the engine surfaces a clear gap.
//
// Special cases not yet handled: capital-gains worksheet, Schedule J
// (farmers/fishermen), Form 8615 (kiddie tax), foreign-earned-income
// worksheet. When facts flag any of these, line 16 will need an
// intermediate decision to route to the right computation; until then, the
// table covers Alex-shaped scenarios cleanly.

// QSS uses the MFJ column per Pub 17 footnote: "* This column must also be
// used by a qualifying surviving spouse."
const FILING_STATUS_TO_TABLE_KEY: Record<string, FilingStatus> = {
  single: "single",
  married_filing_jointly: "mfj",
  married_filing_separately: "mfs",
  head_of_household: "hoh",
  qualifying_surviving_spouse: "mfj",
};

export const taxTable = rule({
  name: "taxTable",
  paramsSchema: z.object({
    /** Decision key for filing status (e.g. "decisions.scope.filing_status"). */
    decisionKey: z.string(),
    /** Field id that holds taxable income (e.g. "form-1040.line.15"). */
    inputFieldId: z.string(),
  }),
  evaluate: (p, ctx) => {
    const decision = ctx.decisions.get(p.decisionKey);
    if (!decision) {
      return blocked(`Need decision: ${p.decisionKey}`, {
        decisionKey: p.decisionKey,
      });
    }
    const decisionValue = String(decision.decision);
    const tableKey = FILING_STATUS_TO_TABLE_KEY[decisionValue];
    if (!tableKey) {
      return unsupported(
        `Filing status "${decisionValue}" has no tax-table column mapping. ` +
          `Expected one of: ${Object.keys(FILING_STATUS_TO_TABLE_KEY).join(", ")}.`,
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
    if (amount < 0) {
      return ok(
        0,
        `Taxable income is zero or negative; tax is zero.`,
        input.supportingFactKeys,
        p.decisionKey,
      );
    }

    const result = lookupTax(ctx.taxYear, amount, tableKey);
    if (!result.ok) {
      if (result.reason === "out_of_range") {
        return unsupported(
          `Taxable income $${amount} is above the IRS Tax Table ceiling. ` +
            `1040 line 16 instructions require the Tax Computation Worksheet ` +
            `for income ≥ $100,000, which is not yet implemented.`,
        );
      }
      if (result.reason === "year_not_supported") {
        return unsupported(
          `No tax table loaded for tax year ${ctx.taxYear}. ` +
            `Run scripts/ingestTaxTable.ts --year ${ctx.taxYear}.`,
        );
      }
      return blocked(result.message);
    }

    const supporting = [
      ...(decision.supportingFactKeys ?? []),
      ...input.supportingFactKeys,
    ];
    return ok(
      result.tax,
      `2025 IRS Tax Table: filing status "${decisionValue}", ` +
        `taxable income $${amount} falls in row [$${result.bracket.low}, $${result.bracket.high}) ` +
        `→ tax $${result.tax}.`,
      Array.from(new Set(supporting)),
      p.decisionKey,
    );
  },
});
