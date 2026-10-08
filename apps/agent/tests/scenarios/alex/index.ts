// Alex scenario bundle.
//
// Alex is our MVP archetype: single CA filer, one W-2 from Brightside
// Logistics, no dependents, standard deduction, no investment income.
// Federal: taxable income $63,250 → tax $8,835 → $585 refund.
// California: taxable income $73,294 → tax $3,256 → $3 owed.
//
// Run just this scenario:
//   npm test -- alex
// Run all scenarios:
//   npm test

import type { Scenario } from "../../types.js";
import { alexFacts, ALEX_TAX_YEAR, ALEX_USER_ID } from "./facts.js";
import { alexDecisions } from "./decisions.js";
import { alexExpected } from "./expected.js";
import { alex540Expected } from "./expected-540.js";

export const alexScenario: Scenario = {
  name: "alex",
  description:
    "Single CA W-2 filer, $79k wages, standard deduction → $585 federal refund, $3 CA owed.",
  taxYear: ALEX_TAX_YEAR,
  userId: ALEX_USER_ID,
  facts: alexFacts,
  decisions: alexDecisions,
  forms: [
    {
      formId: "form-1040",
      goldenPdfPath: "tests/scenarios/alex/docs/Alex-1040-Golden.pdf",
      expected: alexExpected,
    },
    {
      formId: "form-540",
      goldenPdfPath: "tests/scenarios/alex/docs/Alex-CA540-Golden.pdf",
      expected: alex540Expected,
    },
  ],
};
