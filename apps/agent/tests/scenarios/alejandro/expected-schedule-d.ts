// Alejandro Reyes — Schedule D (Form 1040) expected results.
//
// Ground truth: `docs/Alejandro-ScheduleD-Golden.pdf`. Schedule D
// summarizes 8949's per-row detail into Part I (short-term) and Part II
// (long-term) totals, then nets them on Part III line 16 — the value
// that flows to Form 1040 line 7a.
//
// For Alejandro:
//   Part I  line 1b ← 8949 Part I totals  (1,650 / 1,350 / 300)
//   Part II line 8b ← 8949 Part II totals (11,500 / 9,250 / 2,250)
//   Line 7  = net short-term gain  = 300
//   Line 15 = net long-term gain   = 2,250
//   Line 16 = 7 + 15 = 2,550       ← Form 1040 line 7a reads this
//
// Form-flow decisions (Part III):
//   Line 17 = "Yes" — both 15 and 16 are gains.
//   Line 20 = "Yes" — lines 18 and 19 are blank/zero AND not filing
//             Form 4952, so the QDCG worksheet applies for 1040 line 16.
//   Lines 21, 22 — explicitly NOT completed per line 20's instruction.

import type { ExpectedResults } from "../../types.js";

export const alejandroScheduleDExpected: ExpectedResults = {
  engineFields: {
    // ─── Part I — Short-term ──────────────────────────────────────
    "schedule-d.0.line.1b_proceeds": 1650,
    "schedule-d.0.line.1b_cost": 1350,
    "schedule-d.0.line.1b_adjustments": 0,
    "schedule-d.0.line.1b_gain_loss": 300,
    "schedule-d.0.line.7_net_short_term_gain_loss": 300,

    // ─── Part II — Long-term ──────────────────────────────────────
    "schedule-d.0.line.8b_proceeds": 11500,
    "schedule-d.0.line.8b_cost": 9250,
    "schedule-d.0.line.8b_adjustments": 0,
    "schedule-d.0.line.8b_gain_loss": 2250,
    "schedule-d.0.line.15_net_long_term_gain_loss": 2250,

    // ─── Part III — Summary ───────────────────────────────────────
    "schedule-d.1.line.16_combined_gain_loss": 2550,
  },

  renderedText: {
    "schedule-d.0.header.taxpayer_name": "Alejandro Reyes",
    "schedule-d.0.header.ssn": "234567890",
    "schedule-d.0.line.1b_proceeds": "1,650",
    "schedule-d.0.line.1b_cost": "1,350",
    "schedule-d.0.line.1b_gain_loss": "300",
    "schedule-d.0.line.7_net_short_term_gain_loss": "300",
    "schedule-d.0.line.8b_proceeds": "11,500",
    "schedule-d.0.line.8b_cost": "9,250",
    "schedule-d.0.line.8b_gain_loss": "2,250",
    "schedule-d.0.line.15_net_long_term_gain_loss": "2,250",
    "schedule-d.1.line.16_combined_gain_loss": "2,550",
  },

  renderedChecked: [
    // Line 17: Yes (both 15 and 16 are gains).
    "schedule-d.1.line.17_both_gains_yes",
    // Line 20: Yes (lines 18+19 zero, not filing Form 4952 → use QDCG).
    "schedule-d.1.line.20_use_qual_div_worksheet_yes",
  ],

  renderedBlank: [
    // Lines 18 and 19 don't apply (no 28% gain, no §1250 gain).
    "schedule-d.1.line.18_rate_gain_worksheet_amount",
    "schedule-d.1.line.19_unrecaptured_sec1250_gain",
    // Lines 21 and 22 explicitly skipped per line 20 = Yes.
    "schedule-d.1.line.21_allowable_loss",
    // 1a is the alternate aggregation path (we itemized via 8949 → 1b),
    // so 1a stays blank.
    "schedule-d.0.line.1a_proceeds",
    "schedule-d.0.line.8a_proceeds",
  ],
};
