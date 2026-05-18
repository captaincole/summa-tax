// Unit tests for the QDCG worksheet — pure math, no engine setup.
//
// Each case asserts both the final tax AND key intermediate breakdown
// lines so a math regression surfaces at the step that broke, not at
// the cascade downstream.

import { describe, expect, it } from "vitest";
import { computeQdcg } from "./qdcg.js";

describe("computeQdcg", () => {
  it("matches Alejandro's golden — single filer, $381 qual divs + $2,250 LTCG", () => {
    const r = computeQdcg({
      taxableIncome: 87185,
      qualifiedDividends: 381,
      netLongTermGain: 2250,
      filingStatus: "single",
      taxYear: 2025,
    });

    expect(r.tax).toBe(13916);
    expect(r.breakdown.line1).toBe(87185);
    expect(r.breakdown.line4).toBe(2631);      // total preferential
    expect(r.breakdown.line5).toBe(84554);     // ordinary bucket
    expect(r.breakdown.line9).toBe(0);          // none at 0% (ordinary fills past 0% ceiling)
    expect(r.breakdown.line17).toBe(2631);     // all at 15%
    expect(r.breakdown.line18).toBe(395);       // 2,631 × 15% = 394.65 → $395
    expect(r.breakdown.line20).toBe(0);         // none at 20%
    expect(r.breakdown.line22).toBe(13521);    // tax on ordinary $84,554 via 2025 single tax table
    expect(r.breakdown.line24).toBe(14093);    // sanity-check tax on full $87,185
    // Final = line23 = line22 + line18 + line21 = 13,521 + 395 + 0
    expect(r.breakdown.line25).toBe(13916);
  });

  it("no preferential income → matches plain tax-table lookup (Alex shape)", () => {
    // Alex: $63,250 taxable, single, no qual divs, no cap gains.
    const r = computeQdcg({
      taxableIncome: 63250,
      qualifiedDividends: 0,
      netLongTermGain: 0,
      filingStatus: "single",
      taxYear: 2025,
    });

    // With no preferential income, lines 23 and 24 should both equal
    // the plain tax-table value — and 1040 line 16 should match.
    expect(r.tax).toBe(8835);
    expect(r.breakdown.line4).toBe(0);          // preferential bucket empty
    expect(r.breakdown.line5).toBe(63250);     // ordinary = full taxable income
    expect(r.breakdown.line18).toBe(0);
    expect(r.breakdown.line21).toBe(0);
    expect(r.breakdown.line22).toBe(8835);
    expect(r.breakdown.line24).toBe(8835);
    expect(r.tax).toBe(r.ordinaryAlternativeTax); // no QDCG savings
  });

  it("all preferential at 0% — ordinary bucket below the 0% ceiling", () => {
    // Single 2025: 0% ceiling = $48,350. Ordinary $30k leaves $18,350 of
    // 0% room. Preferential $10k fits entirely in the 0% bracket.
    const r = computeQdcg({
      taxableIncome: 40000,
      qualifiedDividends: 0,
      netLongTermGain: 10000,
      filingStatus: "single",
      taxYear: 2025,
    });

    expect(r.breakdown.line5).toBe(30000);     // ordinary bucket
    expect(r.breakdown.line9).toBe(10000);     // all $10k at 0%
    expect(r.breakdown.line17).toBe(0);         // nothing at 15%
    expect(r.breakdown.line20).toBe(0);         // nothing at 20%
    expect(r.breakdown.line18).toBe(0);
    expect(r.breakdown.line21).toBe(0);
    // Tax = just the ordinary bucket tax.
    expect(r.tax).toBe(r.breakdown.line22);
  });

  it("preferential straddles 0% / 15% — ordinary fills part of 0% room", () => {
    // Single 2025: 0% ceiling $48,350. Ordinary $40k → $8,350 of 0%
    // room left. Preferential $20k splits: $8,350 at 0%, $11,650 at 15%.
    const r = computeQdcg({
      taxableIncome: 60000,
      qualifiedDividends: 5000,
      netLongTermGain: 15000,
      filingStatus: "single",
      taxYear: 2025,
    });

    expect(r.breakdown.line4).toBe(20000);
    expect(r.breakdown.line5).toBe(40000);
    expect(r.breakdown.line9).toBe(8350);                  // 0%
    expect(r.breakdown.line17).toBe(11650);                // 15%
    expect(r.breakdown.line18).toBe(1748);                 // 11,650 × 15% = 1,747.5 → $1,748
    expect(r.breakdown.line20).toBe(0);                     // no 20%
  });

  it("MFJ filer at the 0% ceiling boundary — $96,700 single test", () => {
    // MFJ 0% ceiling = $96,700. Ordinary exactly $96,700; preferential
    // $10k all sits above the ceiling → all at 15%.
    const r = computeQdcg({
      taxableIncome: 106700,
      qualifiedDividends: 10000,
      netLongTermGain: 0,
      filingStatus: "married_filing_jointly",
      taxYear: 2025,
    });

    expect(r.breakdown.line5).toBe(96700);
    expect(r.breakdown.line9).toBe(0);
    expect(r.breakdown.line17).toBe(10000);
    expect(r.breakdown.line18).toBe(1500);                 // 10,000 × 15%
  });

  it("hits 20% bracket — single with $1M taxable + $200k preferential", () => {
    // Single 2025: 15% ceiling = $533,400. Ordinary $800k pushes past
    // the 15% ceiling; preferential $200k → first $0 at 0%, all
    // remaining at 20% (because the ordinary part exceeds both
    // thresholds — none of the 15% bracket is available to the
    // preferential dollars).
    const r = computeQdcg({
      taxableIncome: 1000000,
      qualifiedDividends: 0,
      netLongTermGain: 200000,
      filingStatus: "single",
      taxYear: 2025,
    });

    expect(r.breakdown.line5).toBe(800000);     // ordinary
    expect(r.breakdown.line9).toBe(0);           // no 0%
    expect(r.breakdown.line17).toBe(0);          // no 15% (ordinary already past 15% ceiling)
    expect(r.breakdown.line20).toBe(200000);    // all at 20%
    expect(r.breakdown.line21).toBe(40000);     // 200k × 20%
  });

  it("returns line25 = min(line23, line24) when both would be equal", () => {
    // No preferential income — line23 and line24 must be identical (the
    // worksheet's min() acts as a fallback guard).
    const r = computeQdcg({
      taxableIncome: 50000,
      qualifiedDividends: 0,
      netLongTermGain: 0,
      filingStatus: "single",
      taxYear: 2025,
    });
    expect(r.breakdown.line23).toBe(r.breakdown.line24);
    expect(r.tax).toBe(r.breakdown.line24);
  });

  it("throws on negative taxable income", () => {
    expect(() =>
      computeQdcg({
        taxableIncome: -100,
        qualifiedDividends: 0,
        netLongTermGain: 0,
        filingStatus: "single",
        taxYear: 2025,
      }),
    ).toThrow(/taxableIncome must be ≥ 0/);
  });

  it("throws on negative preferential inputs", () => {
    expect(() =>
      computeQdcg({
        taxableIncome: 50000,
        qualifiedDividends: -50,
        netLongTermGain: 0,
        filingStatus: "single",
        taxYear: 2025,
      }),
    ).toThrow(/preferential inputs must be ≥ 0/);
  });
});
