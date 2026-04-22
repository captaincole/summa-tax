// Structured spec for Scenario 01 — Base Case.
// Narrative lives in 01-base-case.md; this file is the machine-readable
// ground truth used by the fixtures pipeline and downstream tests.
//
// When these diverge, the .ts wins for rendering and the .md wins for intent.
// Keep them synced.

import type { ScenarioSpec } from "../pipeline/types.js"

export const scenario: ScenarioSpec = {
  id: "01-base-case",
  taxYear: 2025,
  taxpayer: {
    name: { first: "Alex", last: "Morales" },
    ssn: "123-45-6789",
    address: {
      line1: "2245 Lakeshore Ave Apt 3",
      city: "Oakland",
      state: "CA",
      zip: "94606",
    },
  },
  documents: [
    {
      kind: "W-2",
      outputFilename: "01-alex-w2.pdf",
      employer: {
        name: "Brightside Logistics, Inc.",
        ein: "36-1234567",
        address: {
          line1: "1800 Embarcadero",
          city: "Oakland",
          state: "CA",
          zip: "94606",
        },
      },
      boxes: {
        box1: 79000.00,
        box2: 9420.00,
        box3: 85000.00,
        box4: 5270.00,
        box5: 85000.00,
        box6: 1232.50,
        box12: [{ code: "D", amount: 6000.00 }],
        box13: { retirementPlan: true },
        box14: [{ label: "CA SDI", amount: 935.00 }],
        box15: "CA",
        box16: 79000.00,
        box17: 3100.00,
      },
    },
  ],
}

export default scenario
