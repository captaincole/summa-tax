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
import { alejandro8949Expected } from "./expected-8949.js";
import { alejandroScheduleDExpected } from "./expected-schedule-d.js";
import { register as registerForm1040 } from "../../../src/mastra/engine/federal/1040/bindings.js";
import { register as registerForm540 } from "../../../src/mastra/engine/state/ca/540/bindings.js";
import { register as registerScheduleCa } from "../../../src/mastra/engine/state/ca/schedule-ca/bindings.js";
import { register as registerForm8949 } from "../../../src/mastra/engine/federal/8949/bindings.js";
import { register as registerScheduleD } from "../../../src/mastra/engine/federal/schedule-d/bindings.js";

export const alejandroScenario: Scenario = {
  name: "alejandro",
  description:
    "Single CA W-2 + 1099-DIV/B filer, $100k wages + $385 ordinary divs + $2,550 capital gain → $584 federal refund, $175 CA refund.",
  taxYear: ALEJANDRO_TAX_YEAR,
  userId: ALEJANDRO_USER_ID,
  facts: alejandroFacts,
  decisions: alejandroDecisions,
  forms: [
    // 8949 lives at the top of the dependency chain — Schedule D will
    // read its line 2 totals, and 1040 line 7a flows from Schedule D.
    {
      formId: "form-8949",
      catalogPath: "forms/federal/8949/catalog.json",
      blankPdfPath: "forms/federal/8949/blank.pdf",
      register: registerForm8949,
      expected: alejandro8949Expected,
    },
    {
      formId: "schedule-d",
      catalogPath: "forms/federal/schedule-d/catalog.json",
      blankPdfPath: "forms/federal/schedule-d/blank.pdf",
      register: registerScheduleD,
      expected: alejandroScheduleDExpected,
    },
    {
      formId: "form-1040",
      catalogPath: "forms/federal/1040/catalog.json",
      blankPdfPath: "forms/federal/1040/blank.pdf",
      register: registerForm1040,
      expected: alejandroExpected,
    },
    // Order matters: Schedule CA reads from Form 1040 (federal echoes)
    // and feeds Form 540 (lines 14/16/18), so it sits between them.
    {
      formId: "schedule-ca",
      catalogPath: "forms/state/ca/schedule-ca/catalog.json",
      blankPdfPath: "forms/state/ca/schedule-ca/blank.pdf",
      register: registerScheduleCa,
      expected: alejandroScheduleCaExpected,
    },
    {
      formId: "form-540",
      catalogPath: "forms/state/ca/540/catalog.json",
      blankPdfPath: "forms/state/ca/540/blank.pdf",
      register: registerForm540,
      expected: alejandro540Expected,
    },
  ],
};
