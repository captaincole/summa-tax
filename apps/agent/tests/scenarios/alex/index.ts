// Alex scenario bundle.
//
// Alex is our MVP archetype: single CA filer, one W-2 from Brightside
// Logistics, no dependents, standard deduction, no investment income.
// Federal: taxable income $63,250 → tax $8,835 → $585 refund.
// California: taxable income $73,294 → tax $3,256 → $3 owed.
//
// Run just this scenario:
//   npm run test:alex
// Run all scenarios:
//   npm test

import type { Scenario } from "../../types.js";
import { alexFacts, ALEX_TAX_YEAR, ALEX_USER_ID } from "./facts.js";
import { alexDecisions } from "./decisions.js";
import { alexExpected } from "./expected.js";
import { alex540Expected } from "./expected-540.js";
import { register as registerForm1040 } from "../../../src/mastra/forms/federal/1040/bindings.js";
import { register as registerForm540 } from "../../../src/mastra/forms/state/ca/540/bindings.js";

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
      catalogPath: "ref/forms/form-1040-2025.catalog.json",
      blankPdfPath: "ref/forms/f1040-2025.pdf",
      goldenPdfPath: "tests/scenarios/alex/docs/Alex-1040-Golden.pdf",
      register: registerForm1040,
      expected: alexExpected,
    },
    {
      formId: "form-540",
      catalogPath: "ref/forms/state/ca/form-540-2025.catalog.json",
      blankPdfPath: "ref/forms/state/ca/2025-540.pdf",
      goldenPdfPath: "tests/scenarios/alex/docs/Alex-CA540-Golden.pdf",
      register: registerForm540,
      expected: alex540Expected,
    },
  ],
};
