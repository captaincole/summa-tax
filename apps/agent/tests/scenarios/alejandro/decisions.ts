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
