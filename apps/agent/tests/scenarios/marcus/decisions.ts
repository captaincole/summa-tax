// Marcus Chen — AI decisions (the "setup").
//
// Scoped to what Schedule A needs today: filing status, itemize-vs-
// standard, and per-form must-file flags for the universe of forms the
// engine knows about. Schedule D / 8949 / Schedule CA are explicitly
// declared out of scope here so the scenario stays focused on Schedule
// A + Form 1040 line 12e. The wider Marcus return (Schedule B, 8889,
// 8959, 8960, full 1040 line 23) lights up as those bindings land.

import type { AIDecisionRow } from "../../../src/mastra/db/aiDecisions.js";
import { decisionRow } from "../../helpers/fixtureBuilders.js";
import { MARCUS_TAX_YEAR, MARCUS_USER_ID } from "./facts.js";

const dec = (key: string, decision: unknown, rationale: string) =>
  decisionRow({
    userId: MARCUS_USER_ID,
    taxYear: MARCUS_TAX_YEAR,
    key,
    decision,
    rationale,
  });

export const marcusDecisions: AIDecisionRow[] = [
  dec(
    "decisions.scope.must_file_federal",
    true,
    "W-2 wages $220,000 far exceed any filing threshold; Marcus must file.",
  ),
  dec(
    "decisions.scope.filing_status",
    "single",
    "Marcus stated single filing status.",
  ),
  dec(
    "decisions.scope.has_reportable_sales",
    false,
    "1099-B brokerage trades exist but the scenario at this PR stage scopes them out; capital-gains plumbing arrives with Schedule B/D wiring.",
  ),
  dec(
    "decisions.scope.has_digital_assets",
    false,
    "Marcus reported no crypto / NFT transactions for 2025.",
  ),
  dec(
    "decisions.itemize_vs_standard",
    "itemized",
    "Schedule A total $18,422 (CA tax $15,500 + CA SDI $2,922; OBBBA SALT cap of $40,000 leaves the full amount deductible) exceeds the $15,000 single standard deduction by $3,422.",
  ),
  dec(
    "decisions.scope.must_file_schedule_a",
    true,
    "Itemize decision is `itemized`; Schedule A must be filed with the 1040.",
  ),
  dec(
    "decisions.scope.must_file_schedule_ca",
    false,
    "CA Schedule CA plumbing is out of scope at this PR stage; will turn on when CA-side wiring lands alongside the other Marcus forms.",
  ),
  dec(
    "decisions.scope.must_file_schedule_d",
    false,
    "Capital-gains scope is deferred to a later PR; treating Schedule D as out-of-scope here so the engine doesn't try to evaluate it.",
  ),
  dec(
    "decisions.scope.must_file_8949",
    false,
    "Form 8949 is gated on Schedule D — both out of scope at this PR stage.",
  ),
  dec(
    "decisions.scope.must_file_ca_540",
    false,
    "CA 540 plumbing is out of scope at this PR stage; the scenario today exercises only Form 1040 + Schedule A.",
  ),
  dec(
    "decisions.scope.ca_residency",
    "full_year",
    "Marcus lived in San Francisco, CA for all of 2025.",
  ),
  dec(
    "decisions.refund.refund_full_overpayment_federal",
    true,
    "Marcus has not asked to apply any federal overpayment to 2026 estimated tax; default is to refund the full federal overpayment.",
  ),
];
