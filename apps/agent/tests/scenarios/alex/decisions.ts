// Alex Morales — AI decisions (the "setup").
//
// These are the judgment calls Thom (or Nynaeve, via review) would record
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
];
