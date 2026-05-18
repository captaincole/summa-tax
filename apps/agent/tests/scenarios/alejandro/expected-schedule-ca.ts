// Alejandro Reyes — Schedule CA (540) expected results.
//
// Ground truth: `docs/Alejandro-ScheduleCA-Golden.pdf`. Alejandro has no
// CA-specific income or deduction adjustments — every Schedule CA col B
// (subtractions) and col C (additions) entry is zero. Col A simply
// echoes the corresponding federal Form 1040 line. The only non-trivial
// computation is Part II line 30, which selects between the CA standard
// deduction ($5,706 for single) and itemized total — Alejandro takes
// standard, so $5,706 lands there.
//
// Schedule CA bindings haven't been generated yet — wiring this file
// into the alejandro scenario's forms[] is gated on bindings landing.
// Until then this file documents the target.

import type { ExpectedResults } from "../../types.js";

export const alejandroScheduleCaExpected: ExpectedResults = {
  engineFields: {
    // ─── Part I, Section A — Income from federal Form 1040 ──────────
    // Col A is a pure federal echo; col B/C are zero (no CA adjustments).
    "schedule-ca.0.line.1a_federal": 100_000, // W-2 wages
    "schedule-ca.0.line.1a_subtractions": 0,
    "schedule-ca.0.line.1a_additions": 0,
    "schedule-ca.0.line.1z_federal": 100_000, // sum of 1a–1i
    "schedule-ca.0.line.1z_subtractions": 0,
    "schedule-ca.0.line.1z_additions": 0,
    "schedule-ca.0.line.2b_federal": 0, // taxable interest (none)
    "schedule-ca.0.line.3b_federal": 385, // ordinary dividends
    "schedule-ca.0.line.3b_subtractions": 0,
    "schedule-ca.0.line.3b_additions": 0,
    "schedule-ca.0.line.4b_federal": 0, // IRA distributions (none)
    "schedule-ca.0.line.5b_federal": 0, // pensions (none)
    "schedule-ca.0.line.6b_federal": 0, // social security (none)
    "schedule-ca.0.line.7a_federal": 2_550, // capital gain (from Schedule D)
    "schedule-ca.0.line.7a_subtractions": 0,
    "schedule-ca.0.line.7a_additions": 0,

    // ─── Part I, Section A + Section B totals (line 10) ─────────────
    // Section B (Schedule 1 income) is entirely blank for Alejandro.
    "schedule-ca.2.line.b10_federal": 102_935, // 100,000 + 385 + 2,550
    "schedule-ca.2.line.b10_subtractions": 0,
    "schedule-ca.2.line.b10_additions": 0,

    // ─── Part I, Section C (Schedule 1 adjustments) ─────────────────
    // Alejandro has no above-the-line adjustments. Line 27 (final Part I
    // total) flows to Form 540 line 14 (col B) and line 16 (col C).
    "schedule-ca.3.line.c27_federal": 102_935,
    "schedule-ca.3.line.c27_subtractions": 0,
    "schedule-ca.3.line.c27_additions": 0,

    // ─── Part II — Adjustments to Federal Itemized Deductions ───────
    // Alejandro takes the standard deduction, so every itemized-detail
    // line is zero and line 30 lands on the CA single std deduction.
    "schedule-ca.5.page2.total_itemized_30_standard_or_itemized": 5_706,
  },

  renderedText: {
    // Header — Schedule CA prints "First Last" as a single combined name.
    "schedule-ca.0.header.name": "Alejandro Reyes",
    // SSN renders as bare digits via the FilingInfo SSN brand (same
    // pattern as Form 540 page-1 header.ssn). The Schedule CA widget has
    // maxLength=11 so it could accept dashes, but a formatter override
    // would be needed; deferred until binding generation surfaces the
    // need.
    "schedule-ca.0.header.ssn": "234567890",
  },

  // The "did you NOT itemize for federal but will itemize for California"
  // checkbox — Alejandro itemizes neither federal nor CA, so this stays
  // unchecked.
  renderedBlank: [
    "schedule-ca.4.page2.itemize_ca_not_federal",
  ],

  renderedChecked: [],
};
