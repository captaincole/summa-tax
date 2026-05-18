// Alejandro scenario bundle.
//
// Alejandro is the next step up from Alex: still a single CA filer with
// one W-2, but with investment income (qualified dividends + net long-
// term capital gain from stock sales). This forces:
//   - Federal 1040 line 7a from Schedule D (needs new bindings)
//   - Federal 1040 line 16 via the Qualified Dividends and Capital Gain
//     Tax Worksheet (current binding does plain tax-table lookup)
//   - Schedule CA col A federal echoes (col B/C all zero — no adjustments)
//
// Federal: taxable income $87,185 → tax $13,916 → $584 refund.
// California: taxable income $97,229 → tax $5,478 → $175 refund.
//
// Run just this scenario:
//   npm run test:alejandro
// Run all scenarios:
//   npm test

import type { Scenario } from "../../types.js";
import { alejandroFacts, ALEJANDRO_TAX_YEAR, ALEJANDRO_USER_ID } from "./facts.js";
import { alejandroDecisions } from "./decisions.js";
import { alejandroExpected } from "./expected.js";
import { alejandro540Expected } from "./expected-540.js";
import { alejandroScheduleCaExpected } from "./expected-schedule-ca.js";
import { register as registerForm1040 } from "../../../src/mastra/engine/federal/1040/bindings.js";
import { register as registerForm540 } from "../../../src/mastra/engine/state/ca/540/bindings.js";
import { register as registerScheduleCa } from "../../../src/mastra/engine/state/ca/schedule-ca/bindings.js";

export const alejandroScenario: Scenario = {
  name: "alejandro",
  description:
    "Single CA W-2 + 1099-DIV/B filer, $100k wages + $385 ordinary divs + $2,550 capital gain → $584 federal refund, $175 CA refund.",
  taxYear: ALEJANDRO_TAX_YEAR,
  userId: ALEJANDRO_USER_ID,
  facts: alejandroFacts,
  decisions: alejandroDecisions,
  forms: [
    {
      formId: "form-1040",
      catalogPath: "forms/federal/1040/catalog.json",
      blankPdfPath: "forms/federal/1040/blank.pdf",
      register: registerForm1040,
      expected: alejandroExpected,
    },
    {
      formId: "form-540",
      catalogPath: "forms/state/ca/540/catalog.json",
      blankPdfPath: "forms/state/ca/540/blank.pdf",
      register: registerForm540,
      expected: alejandro540Expected,
    },
    {
      formId: "schedule-ca",
      catalogPath: "forms/state/ca/schedule-ca/catalog.json",
      blankPdfPath: "forms/state/ca/schedule-ca/blank.pdf",
      register: registerScheduleCa,
      expected: alejandroScheduleCaExpected,
    },
  ],
};
