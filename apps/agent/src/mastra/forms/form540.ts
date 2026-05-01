// California Form 540 — California Resident Income Tax Return
//
// First state form. Pulls federal AGI from Form 1040 line 11 and W-2 box
// 16/17 sums for state wages + withholding. Applies CA's own standard
// deduction (smaller than federal) and tax brackets.
//
// Scope for the first iteration (Alejandro):
//   12  — California wages (W-2 box 16 sum)
//   13  — Federal AGI (from 1040 line 11)
//   17  — California AGI (= federal AGI; no Schedule CA adjustments yet)
//   18  — Standard deduction (per filing-status decision)
//   19  — Taxable income
//   31  — Tax (CA brackets — APPROXIMATE 2024 figures; see header note)
//   64  — Total tax (= line 31 until we model exemption credits + other taxes)
//   71  — California income tax withheld from W-2 box 17
//   78  — Total payments (= line 71 until we model estimated payments etc.)
//   97 / 100 — Overpaid tax (refund) or tax due
//
// Known simplifications, called out so they aren't surprises:
//   - **Brackets and standard deduction use 2024 figures as a stand-in for
//     2025 until we extract the exact numbers from the ingested CA 540
//     booklet.** CA inflation-adjusts these annually; for Alejandro the
//     difference is in the dollars, not the architecture.
//   - **Exemption credits skipped.** For 2024, single basic exemption
//     credit was $144. Alejandro is overstated by ~$144 in tax.
//   - **No Schedule CA.** We assume CA AGI = Federal AGI. Holds for
//     Alejandro because he has no muni interest, no HSA, no foreign
//     income, etc. — but real returns often have small adjustments here.

import {
  ok,
  blocked,
  type BaseLine,
  type DerivationContext,
  type DerivationResult,
  type EvaluatedForm,
} from "./types.js";
import type { EvaluatedForm1040, Form1040NumericLine } from "./form1040.js";
import { getW2Facts } from "../facts/index.js";

// ─── Line shape ──────────────────────────────────────────────────────────

export type Form540LineNumber =
  | "12" | "13"
  | "17" | "18" | "19"
  | "31" | "64"
  | "71" | "78"
  | "97" | "100";

export interface Form540NumericLine extends BaseLine<number> {
  lineKind: "form-540.numeric";
  lineNumber: Form540LineNumber;
}

export type Form540Line = Form540NumericLine;

export type EvaluatedForm540 = EvaluatedForm<Form540Line>;

// ─── 2024 CA constants used as 2025 stand-ins (TODO: verify) ─────────────

const CA_STANDARD_DEDUCTION_2024: Record<string, number> = {
  single: 5540,
  married_filing_jointly: 11080,
  married_filing_separately: 5540,
  head_of_household: 11080,
  qualifying_surviving_spouse: 11080,
};

// CA 2024 single brackets: [lo, hi, rate]. Top bracket has hi = Infinity.
// Actual 2025 values to be confirmed against ingested CA 540 booklet.
const CA_BRACKETS_2024_SINGLE: Array<[number, number, number]> = [
  [0,        10_756,  0.01],
  [10_756,   25_499,  0.02],
  [25_499,   40_245,  0.04],
  [40_245,   55_866,  0.06],
  [55_866,   70_606,  0.08],
  [70_606,  360_659,  0.093],
  [360_659, 432_787,  0.103],
  [432_787, 721_314,  0.113],
  [721_314, Infinity, 0.123],
];

const caTaxSingle = (taxable: number): number => {
  if (taxable <= 0) return 0;
  let tax = 0;
  for (const [lo, hi, rate] of CA_BRACKETS_2024_SINGLE) {
    if (taxable <= lo) break;
    const slice = Math.min(taxable, hi) - lo;
    tax += slice * rate;
  }
  return Math.round(tax * 100) / 100;
};

// ─── Evaluator ───────────────────────────────────────────────────────────

export function evaluateForm540(
  ctx: DerivationContext,
  form1040: EvaluatedForm1040,
): EvaluatedForm540 {
  const lines: Form540Line[] = [];

  const mustFile = mustFileForm540(ctx);
  const baseForm: Omit<EvaluatedForm540, "lines"> = {
    formId: "form-540",
    jurisdiction: "state-ca",
    title: "California Resident Income Tax Return",
    taxYear: ctx.taxYear,
    mustFile,
  };
  if (!mustFile.ok || !mustFile.value) {
    return { ...baseForm, lines };
  }

  // ─── Pull federal AGI from 1040 line 11 ───
  const federalAgiResult = readFormLine(form1040, "11", "Federal AGI from Form 1040 line 11");
  const federalAgi = federalAgiResult.ok ? federalAgiResult.value : 0;
  const federalAgiFactKeys = federalAgiResult.ok ? federalAgiResult.supportingFactKeys : [];

  // ─── State wages + withholding from W-2s ───
  const w2s = getW2Facts(ctx.facts);
  const stateWages = w2s.reduce((s, w) => s + (w.w2.box16 ?? 0), 0);
  const stateWithholding = w2s.reduce((s, w) => s + (w.w2.box17 ?? 0), 0);
  const w2FactKeys = w2s.map((w) => w.sourceFact.key);

  // Line 12 — California wages from W-2 box 16
  lines.push(
    numericLine("12", "California wages from Form(s) W-2, box 16", ok(
      stateWages,
      `Sum of W-2 box 16 across ${w2s.length} W-2(s).`,
      w2FactKeys,
    )),
  );

  // Line 13 — Federal AGI (from 1040 line 11)
  lines.push(numericLine("13", "Federal AGI from Form 1040 line 11", federalAgiResult));

  // Line 17 — California AGI. Equals federal AGI when no Schedule CA
  // adjustments are required (true for Alejandro).
  const caAgi = federalAgi;
  lines.push(
    numericLine("17", "California adjusted gross income", ok(
      caAgi,
      "No Schedule CA adjustments; CA AGI = Federal AGI.",
      federalAgiFactKeys,
    )),
  );

  // Line 18 — California standard deduction (filing-status decision)
  const filingStatus = ctx.decisions.get("decisions.scope.filing_status");
  if (!filingStatus) {
    lines.push({
      lineKind: "form-540.numeric",
      lineNumber: "18",
      lineId: "form-540.line.18",
      label: "California standard deduction",
      result: blocked("Need filing-status decision", {
        decisionKey: "decisions.scope.filing_status",
      }),
    });
    return { ...baseForm, lines };
  }
  const fs = String(filingStatus.decision);
  const stdDed = CA_STANDARD_DEDUCTION_2024[fs];
  if (stdDed === undefined) {
    lines.push({
      lineKind: "form-540.numeric",
      lineNumber: "18",
      lineId: "form-540.line.18",
      label: "California standard deduction",
      result: blocked(
        `Unknown filing status "${fs}"; expected one of ${Object.keys(CA_STANDARD_DEDUCTION_2024).join(", ")}`,
        { decisionKey: "decisions.scope.filing_status" },
      ),
    });
    return { ...baseForm, lines };
  }
  lines.push(
    numericLine("18", "California standard deduction", ok(
      stdDed,
      `2024 CA standard deduction for ${fs} (used as 2025 stand-in).`,
      filingStatus.supportingFactKeys,
      "decisions.scope.filing_status",
    )),
  );

  // Line 19 — California taxable income
  const taxable = Math.max(0, caAgi - stdDed);
  lines.push(
    numericLine("19", "California taxable income", ok(
      taxable,
      "CA AGI minus standard deduction.",
      [...federalAgiFactKeys, ...filingStatus.supportingFactKeys],
    )),
  );

  // Line 31 — Tax (CA brackets, ordinary rates only — CA does not give
  // preferential treatment to LTCG or qualified dividends)
  const tax = caTaxSingle(taxable);
  lines.push(
    numericLine("31", "Tax", ok(
      tax,
      "Computed via 2024 CA single brackets (used as 2025 stand-in). " +
      "CA taxes long-term capital gains and qualified dividends at ordinary rates — " +
      "no QDCG worksheet equivalent.",
      [...federalAgiFactKeys, ...filingStatus.supportingFactKeys],
    )),
  );

  // Line 64 — Total tax (currently = line 31; will subtract exemption
  // credits and add behavioral-health-services / other taxes as those land)
  lines.push(
    numericLine("64", "Add line 48, line 61, line 62, and line 63. This is your total tax.", ok(
      tax,
      "Currently equal to line 31 (exemption credits + other taxes not yet modeled).",
      [],
    )),
  );

  // Line 71 — California income tax withheld
  lines.push(
    numericLine("71", "California income tax withheld", ok(
      stateWithholding,
      `Sum of W-2 box 17 across ${w2s.length} W-2(s).`,
      w2FactKeys,
    )),
  );

  // Line 78 — Total payments (currently = line 71; estimated payments, etc.,
  // are not yet modeled)
  lines.push(
    numericLine("78", "Add line 71 through line 77. These are your total payments.", ok(
      stateWithholding,
      "Currently equal to line 71 (estimated payments + other credits not yet modeled).",
      w2FactKeys,
    )),
  );

  // Lines 97 / 100 — Overpaid tax (refund) or tax due. CA 540 has a couple
  // of intermediate steps (use tax line 91, ISR penalty line 92, payments
  // balance line 93, etc.) — for now we collapse those (all zero for our
  // scope) and emit only the final refund/owed line.
  if (stateWithholding >= tax) {
    lines.push(
      numericLine("97", "Overpaid tax. If line 95 is more than line 64, subtract line 64 from line 95.", ok(
        Math.round((stateWithholding - tax) * 100) / 100,
        "Refund owed to taxpayer by FTB.",
        w2FactKeys,
      )),
    );
  } else {
    lines.push(
      numericLine("100", "Tax due. If line 95 is less than line 64, subtract line 95 from line 64.", ok(
        Math.round((tax - stateWithholding) * 100) / 100,
        "Balance due to FTB.",
        w2FactKeys,
      )),
    );
  }

  return { ...baseForm, lines };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function numericLine(
  lineNumber: Form540LineNumber,
  label: string,
  result: DerivationResult<number>,
): Form540NumericLine {
  return {
    lineKind: "form-540.numeric",
    lineNumber,
    lineId: `form-540.line.${lineNumber}`,
    label,
    result,
  };
}

/**
 * Read a numeric line from another form, handling the three states a
 * cross-form reference can be in:
 *   - Source form not required → propagate as blocked (state forms can't
 *     reasonably proceed without their federal counterpart)
 *   - Source form required but line missing/blocked → propagate the block
 *   - Source form required and line has value → return the value
 */
function readFormLine(
  form1040: EvaluatedForm1040,
  lineNumber: Form1040NumericLine["lineNumber"],
  label: string,
): DerivationResult<number> {
  if (!form1040.mustFile.ok) {
    return blocked(`Form 1040 mustFile blocked: ${form1040.mustFile.reason}`, {
      decisionKey: form1040.mustFile.missingDecisionKey,
      factKeys: form1040.mustFile.missingFactKeys,
    });
  }
  if (form1040.mustFile.value === false) {
    return blocked(
      "CA Form 540 depends on Form 1040, but Form 1040 is not required for this taxpayer",
    );
  }
  const line = form1040.lines.find(
    (l): l is Form1040NumericLine =>
      l.lineKind === "form-1040.numeric" && l.lineNumber === lineNumber,
  );
  if (!line) {
    return blocked(`Form 1040 line ${lineNumber} not emitted (${label})`);
  }
  if (!line.result.ok) {
    return blocked(
      `Form 1040 line ${lineNumber} blocked: ${line.result.reason}`,
      {
        decisionKey: line.result.missingDecisionKey,
        factKeys: line.result.missingFactKeys,
      },
    );
  }
  return ok(
    line.result.value,
    `From Form 1040 line ${lineNumber}.`,
    line.result.supportingFactKeys,
  );
}

function mustFileForm540(ctx: DerivationContext): DerivationResult<boolean> {
  const decision = ctx.decisions.get("decisions.scope.must_file_ca_540");
  if (!decision) {
    return blocked("Need scope decision: must_file_ca_540", {
      decisionKey: "decisions.scope.must_file_ca_540",
    });
  }
  return ok<boolean>(
    decision.decision === true,
    decision.rationale,
    decision.supportingFactKeys,
    "decisions.scope.must_file_ca_540",
  );
}
