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

export const alejandroScenario: Scenario = {
  name: "alejandro",
  description:
    "Single CA W-2 + 1099-DIV/B filer, $100k wages + $385 ordinary divs + $2,550 capital gain → $584 federal refund, $175 CA refund.",
  taxYear: ALEJANDRO_TAX_YEAR,
  userId: ALEJANDRO_USER_ID,
  facts: alejandroFacts,
  decisions: alejandroDecisions,
  // Forms in dependency order: 8949 → Schedule D → 1040 → Schedule CA →
  // 540. The registry imposes the same order at the engine level, so
  // this listing matches the fixpoint evaluation sequence.
  forms: [
    { formId: "form-8949", expected: alejandro8949Expected },
    { formId: "schedule-d", expected: alejandroScheduleDExpected },
    { formId: "form-1040", expected: alejandroExpected },
    { formId: "schedule-ca", expected: alejandroScheduleCaExpected },
    { formId: "form-540", expected: alejandro540Expected },
  ],
};
