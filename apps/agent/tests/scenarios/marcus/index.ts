// Marcus Chen scenario bundle.
//
// Marcus is our higher-income archetype: single CA filer, $220k W-2 wages,
// HSA + 401(k) pre-tax payroll, itemized deductions driven by the 2025
// OBBBA SALT cap. This file currently exercises Form 1040 + Schedule A
// only — Schedule B (1099-INT plumbing), Schedule 2, Form 8889 / 8959 /
// 8960, Schedule D, and the CA-side forms turn on as their bindings land.

import type { Scenario } from "../../types.js";
import { marcusFacts, MARCUS_TAX_YEAR, MARCUS_USER_ID } from "./facts.js";
import { marcusDecisions } from "./decisions.js";
import { marcusExpected } from "./expected.js";
import { marcusScheduleAExpected } from "./expected-schedule-a.js";
import { marcus8959Expected } from "./expected-8959.js";

export const marcusScenario: Scenario = {
  name: "marcus",
  description:
    "Single CA filer, $220k W-2 wages, itemized deductions (SALT-only $18,422) — exercises Schedule A + 1040 line 12e itemized flip.",
  taxYear: MARCUS_TAX_YEAR,
  userId: MARCUS_USER_ID,
  facts: marcusFacts,
  decisions: marcusDecisions,
  // Schedule A listed before form-1040 so the engine evaluates it
  // first in pass 1 — 1040 line 12e (itemized → Schedule A line 17)
  // resolves in the same pass instead of needing a fixpoint round-trip.
  forms: [
    {
      formId: "schedule-a",
      goldenPdfPath: "tests/scenarios/marcus/docs/Marcus-ScheduleA-Golden.pdf",
      expected: marcusScheduleAExpected,
    },
    {
      formId: "form-8959",
      goldenPdfPath: "tests/scenarios/marcus/docs/Marcus-8959-Golden.pdf",
      expected: marcus8959Expected,
    },
    {
      formId: "form-1040",
      // No goldenPdfPath yet — the full 1040 won't match the CPA's
      // golden until 1099-INT, brokerage, and Schedule 2 wiring land.
      expected: marcusExpected,
    },
  ],
};
