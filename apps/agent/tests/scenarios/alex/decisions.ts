// Alex Morales — AI decisions (the "setup").
//
// These are the judgment calls Luca (or Nynaeve, via review) would record
// during a real intake. For the integration test we set them directly so
// the engine has everything it needs without needing the agent loop.

import type { AIDecisionRow } from "../../../src/mastra/db/aiDecisions.js";
import { decisionRow } from "../../helpers/fixtureBuilders.js";
import { ALEX_TAX_YEAR, ALEX_USER_ID } from "./facts.js";

const dec = (key: string, decision: unknown, rationale: string) =>
  decisionRow({
    userId: ALEX_USER_ID,
    taxYear: ALEX_TAX_YEAR,
    key,
    decision,
    rationale,
  });

export const alexDecisions: AIDecisionRow[] = [
  dec(
    "decisions.scope.must_file_federal",
    true,
    "W-2 wages $79,000 exceed the single-filer standard deduction; Alex must file.",
  ),
  dec(
    "decisions.scope.filing_status",
    "single",
    "Alex stated single filing status.",
  ),
  dec(
    "decisions.scope.has_reportable_sales",
    false,
    "No 1099-B or other sales-related documents provided.",
  ),
  dec(
    "decisions.scope.has_digital_assets",
    false,
    "Alex reported no digital asset (crypto / NFT) transactions for 2025 — 1040 page 1 digital-assets question answered No.",
  ),
  // Form-scope decisions follow the convention
  // `decisions.scope.must_file_<form_short_id>`. Each scenario records the
  // gating decision for every form in the universe — true means the form
  // is in this scenario's forms[] and asserted against; false means we
  // declare it out-of-scope and don't list it. Keeps "why isn't Alex
  // filing X?" answerable by grep instead of code archaeology.
  dec(
    "decisions.scope.must_file_schedule_ca",
    false,
    "Single W-2-only filer with no federal-vs-CA adjustments — no items in Schedule CA Section A col B/C, Section B/C, or Part II would be nonzero. CA conforms to federal on every line Alex touches; Schedule CA is not required.",
  ),
  dec(
    "decisions.scope.must_file_schedule_d",
    false,
    "No capital gain or loss transactions — no 1099-B and no other reportable sales. Schedule D is not required.",
  ),
  dec(
    "decisions.scope.must_file_8949",
    false,
    "No reportable security sales; Form 8949 only attaches when Schedule D is required. Not in scope for Alex.",
  ),
  dec(
    "decisions.scope.must_file_ca_540",
    true,
    "Alex is a full-year California resident with W-2 wages of $79,000 — above the CA filing threshold for single filers; CA Form 540 is required.",
  ),
  dec(
    "decisions.scope.ca_residency",
    "full_year",
    "Alex lived in Oakland, CA for all of 2025 (no part-year or multi-state activity).",
  ),
  dec(
    "decisions.scope.mailing_same_as_principal_residence",
    true,
    "Alex rents at 2245 Lakeshore Ave Apt 3, Oakland — that's both his mailing address and where he actually lives. No PO box or separate principal residence to distinguish.",
  ),
  dec(
    "decisions.scope.use_tax_zero_reason",
    "no_use_tax_owed",
    "Alex reported no out-of-state online purchases in 2025; line 91 is $0 with the 'No use tax is owed' option selected.",
  ),
  dec(
    "decisions.refund.refund_full_overpayment_federal",
    true,
    "Alex has not indicated a preference to apply any of the federal overpayment to 2026 estimated tax; default is to refund the full federal overpayment.",
  ),
  dec(
    "decisions.refund.refund_full_overpayment_ca",
    true,
    "Alex has not indicated a preference to apply any of the CA overpayment to 2026 estimated tax; default is to refund the full CA overpayment.",
  ),
];
