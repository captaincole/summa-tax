// Cross-check the rate-schedule lookup against the IRS-published formula
// pieces. Each case picks a representative income inside a bracket and
// confirms tax = income × rate − subtraction.

import { describe, expect, it } from "vitest";
import { lookupRateSchedule } from "./rateSchedule.js";

describe("lookupRateSchedule — 2025 federal", () => {
  describe("single", () => {
    it("$101,000 → 22% bracket: 101,000 × 0.22 − 5,086 = 17,134", () => {
      // 22% bracket for single is very narrow: $100k–$103,350.
      expect(lookupRateSchedule(2025, "single", 101_000)).toBeCloseTo(17_134, 2);
    });
    it("$150,000 → 24% bracket: 150,000 × 0.24 − 7,153 = 28,847", () => {
      expect(lookupRateSchedule(2025, "single", 150_000)).toBeCloseTo(28_847, 2);
    });
    it("$200,000 → 32% bracket: 200,000 × 0.32 − 22,937 = 41,063", () => {
      expect(lookupRateSchedule(2025, "single", 200_000)).toBeCloseTo(41_063, 2);
    });
    it("$700,000 → 37% bracket: 700,000 × 0.37 − 42,979.75 = 216,020.25", () => {
      expect(lookupRateSchedule(2025, "single", 700_000)).toBeCloseTo(216_020.25, 2);
    });
  });

  describe("married_filing_jointly", () => {
    it("$150,000 → 22% bracket", () => {
      expect(lookupRateSchedule(2025, "married_filing_jointly", 150_000)).toBeCloseTo(
        150_000 * 0.22 - 10_172,
        2,
      );
    });
    it("$300,000 → 24% bracket", () => {
      expect(lookupRateSchedule(2025, "married_filing_jointly", 300_000)).toBeCloseTo(
        300_000 * 0.24 - 14_306,
        2,
      );
    });
  });

  describe("head_of_household", () => {
    it("$150,000 → 24% bracket", () => {
      expect(lookupRateSchedule(2025, "head_of_household", 150_000)).toBeCloseTo(
        150_000 * 0.24 - 8_892,
        2,
      );
    });
  });

  it("throws for income < $100,000 (should use tax table)", () => {
    expect(() => lookupRateSchedule(2025, "single", 50_000)).toThrow(/Use lookupTax/);
  });

  it("throws on unknown tax year", () => {
    expect(() => lookupRateSchedule(2099, "single", 150_000)).toThrow(
      /No rate schedule/,
    );
  });
});
