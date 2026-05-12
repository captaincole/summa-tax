// Alex scenario bundle.
//
// Alex is our MVP archetype: single CA filer, one W-2 from Brightside
// Logistics, no dependents, standard deduction, no investment income.
// Taxable income $63,250 → tax $8,835 (2025 IRS Tax Table) → $585 refund.
//
// Run just this scenario:
//   npm run test:alex
// Run all scenarios:
//   npm test

import type { Scenario } from "../../types.js";
import { alexFacts, ALEX_TAX_YEAR, ALEX_USER_ID } from "./facts.js";
import { alexDecisions } from "./decisions.js";
import { alexExpected } from "./expected.js";

export const alexScenario: Scenario = {
  name: "alex",
  description:
    "Single CA W-2 filer, $79k wages, standard deduction → $585 refund (canonical happy path).",
  formId: "form-1040",
  taxYear: ALEX_TAX_YEAR,
  userId: ALEX_USER_ID,
  facts: alexFacts,
  decisions: alexDecisions,
  expected: alexExpected,
};
