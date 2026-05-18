// Alejandro Reyes — Form 8949 expected results.
//
// Ground truth: `docs/Alejandro-8949-Golden.pdf` (itemization version).
// Alejandro has exactly two covered-basis-reported trades from his
// Apex Securities 1099-B:
//   - NVDA short-term  → Part I, Box A, Row 1
//   - AAPL long-term   → Part II, Box D, Row 1
// Each trade maps 1:1 to a Form 8949 row. The line 2 totals are
// trivial single-row sums that flow into Schedule D line 1b
// (short-term) and line 8b (long-term).

import type { ExpectedResults } from "../../types.js";

export const alejandro8949Expected: ExpectedResults = {
  engineFields: {
    // ─── Part I (short-term, Box A — NVDA) ──────────────────────────
    "form-8949.0.part1.row1_proceeds": 1650,
    "form-8949.0.part1.row1_cost_basis": 1350,
    "form-8949.0.part1.row1_gain_loss": 300,
    "form-8949.0.part1.totals_proceeds": 1650,
    "form-8949.0.part1.totals_cost_basis": 1350,
    "form-8949.0.part1.totals_adjustment_amount": 0,
    "form-8949.0.part1.totals_gain_loss": 300,

    // ─── Part II (long-term, Box D — AAPL) ──────────────────────────
    "form-8949.1.part2.row1_proceeds": 11500,
    "form-8949.1.part2.row1_cost_basis": 9250,
    "form-8949.1.part2.row1_gain_loss": 2250,
    "form-8949.1.part2.totals_proceeds": 11500,
    "form-8949.1.part2.totals_cost_basis": 9250,
    "form-8949.1.part2.totals_adjustment_amount": 0,
    "form-8949.1.part2.totals_gain_loss": 2250,
  },

  renderedText: {
    "form-8949.0.header.taxpayer_name": "Alejandro Reyes",
    "form-8949.0.header.ssn": "234567890",
    // Part I row 1 — NVDA short-term.
    "form-8949.0.part1.row1_description": "10 sh NVIDIA CORP",
    "form-8949.0.part1.row1_date_acquired": "02/10/25",
    "form-8949.0.part1.row1_date_sold": "11/20/25",
    "form-8949.0.part1.row1_proceeds": "1,650",
    "form-8949.0.part1.row1_cost_basis": "1,350",
    "form-8949.0.part1.row1_gain_loss": "300",
    "form-8949.0.part1.totals_proceeds": "1,650",
    "form-8949.0.part1.totals_cost_basis": "1,350",
    "form-8949.0.part1.totals_gain_loss": "300",
    // Part II row 1 — AAPL long-term.
    "form-8949.1.part2.row1_description": "50 sh APPLE INC",
    "form-8949.1.part2.row1_date_acquired": "06/15/23",
    "form-8949.1.part2.row1_date_sold": "09/15/25",
    "form-8949.1.part2.row1_proceeds": "11,500",
    "form-8949.1.part2.row1_cost_basis": "9,250",
    "form-8949.1.part2.row1_gain_loss": "2,250",
    "form-8949.1.part2.totals_proceeds": "11,500",
    "form-8949.1.part2.totals_cost_basis": "9,250",
    "form-8949.1.part2.totals_gain_loss": "2,250",
  },

  renderedBlank: [
    // Sample of unused rows on both parts — only row 1 is populated.
    "form-8949.0.part1.row2_description",
    "form-8949.0.part1.row3_description",
    "form-8949.1.part2.row2_description",
    "form-8949.1.part2.row3_description",
  ],

  renderedChecked: [
    "form-8949.0.part1.box_a_short_term_basis_reported",
    "form-8949.1.part2.box_d_long_term_basis_reported",
  ],
};
