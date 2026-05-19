// Alejandro Reyes — AI decisions (the "setup").
//
// Same setup pattern as Alex. The two differences relative to Alex:
//   - Alejandro has 1099-B activity, so `has_reportable_sales = true`
//     (which would in production gate Schedule D / 8949 ingest).
//   - Filing status, residency, refund prefs, and use-tax-zero reason
//     are otherwise identical to Alex.

import type { AIDecisionRow } from "../../../src/mastra/db/aiDecisions.js";
import { decisionRow } from "../../helpers/fixtureBuilders.js";
import { ALEJANDRO_TAX_YEAR, ALEJANDRO_USER_ID } from "./facts.js";

const dec = (key: string, decision: unknown, rationale: string) =>
  decisionRow({
    userId: ALEJANDRO_USER_ID,
    taxYear: ALEJANDRO_TAX_YEAR,
    key,
    decision,
    rationale,
  });

export const alejandroDecisions: AIDecisionRow[] = [
  dec(
    "decisions.scope.must_file_federal",
    true,
    "W-2 wages $100,000 plus dividend and capital-gain income exceed the single-filer standard deduction; Alejandro must file.",
  ),
  dec(
    "decisions.scope.filing_status",
    "single",
    "Alejandro stated single filing status.",
  ),
  dec(
    "decisions.scope.has_reportable_sales",
    true,
    "Apex Securities 1099-B reports two covered-security sales (NVDA short-term, AAPL long-term) totaling $2,550 in realized gains — Schedule D / Form 8949 are required.",
  ),
  dec(
    "decisions.scope.has_digital_assets",
    false,
    "Alejandro reported no crypto / NFT / other digital asset activity for 2025 — 1040 page 1 digital-assets question answered No.",
  ),
  // Form-scope decisions follow the convention
  // `decisions.scope.must_file_<form_short_id>`. See alex/decisions.ts for
  // the parallel false-cases that document why Alex doesn't file these.
  dec(
    "decisions.scope.must_file_schedule_ca",
    true,
    "Alejandro files Schedule CA (540) to document the col A federal echoes for the income lines that flow into CA AGI. Even though col B (subtractions) and col C (additions) are all zero for his scenario — CA conforms to federal on wages, dividends, and capital gains — the schedule is filed alongside the 540.",
  ),
  dec(
    "decisions.scope.must_file_schedule_d",
    true,
    "Net capital gain of $2,550 (short-term $300 + long-term $2,250) from Apex Securities 1099-B requires Schedule D to compute and report.",
  ),
  dec(
    "decisions.scope.must_file_8949",
    true,
    "Two covered-security sales (NVDA short-term box A, AAPL long-term box D) are itemized on Form 8949 with basis-reported boxes; totals flow to Schedule D.",
  ),
  dec(
    "decisions.scope.must_file_ca_540",
    true,
    "Alejandro is a full-year California resident with $100,000 of CA wages and additional CA-source investment income — well above the CA filing threshold for single filers; CA Form 540 is required.",
  ),
  dec(
    "decisions.scope.ca_residency",
    "full_year",
    "Alejandro lived at 123 Valencia Street, San Francisco for all of 2025 (no part-year or multi-state activity).",
  ),
  dec(
    "decisions.scope.mailing_same_as_principal_residence",
    true,
    "Alejandro's mailing address at 123 Valencia Street, San Francisco is also his principal residence — no PO box or separate residence address.",
  ),
  dec(
    "decisions.scope.use_tax_zero_reason",
    "no_use_tax_owed",
    "Alejandro reported no out-of-state online purchases in 2025; line 91 is $0 with the 'No use tax is owed' option selected.",
  ),
  dec(
    "decisions.refund.refund_full_overpayment_federal",
    true,
    "Alejandro has not indicated a preference to apply any of the federal overpayment to 2026 estimated tax; default is to refund the full federal overpayment.",
  ),
  dec(
    "decisions.refund.refund_full_overpayment_ca",
    true,
    "Alejandro has not indicated a preference to apply any of the CA overpayment to 2026 estimated tax; default is to refund the full CA overpayment.",
  ),
];
