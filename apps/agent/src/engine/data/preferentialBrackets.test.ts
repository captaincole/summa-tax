import { describe, expect, it } from "vitest";
import { lookupPreferentialBrackets } from "./preferentialBrackets.js";

describe("lookupPreferentialBrackets — 2025 federal", () => {
  it("single — $48,350 / $533,400", () => {
    const b = lookupPreferentialBrackets(2025, "single");
    expect(b.zeroRateCeiling).toBe(48350);
    expect(b.fifteenRateCeiling).toBe(533400);
  });
  it("married_filing_jointly — $96,700 / $600,050", () => {
    const b = lookupPreferentialBrackets(2025, "married_filing_jointly");
    expect(b.zeroRateCeiling).toBe(96700);
    expect(b.fifteenRateCeiling).toBe(600050);
  });
  it("married_filing_separately — $48,350 / $300,000", () => {
    const b = lookupPreferentialBrackets(2025, "married_filing_separately");
    expect(b.zeroRateCeiling).toBe(48350);
    expect(b.fifteenRateCeiling).toBe(300000);
  });
  it("head_of_household — $64,750 / $566,700", () => {
    const b = lookupPreferentialBrackets(2025, "head_of_household");
    expect(b.zeroRateCeiling).toBe(64750);
    expect(b.fifteenRateCeiling).toBe(566700);
  });
  it("qualifying_surviving_spouse — same as MFJ", () => {
    const b = lookupPreferentialBrackets(2025, "qualifying_surviving_spouse");
    expect(b.zeroRateCeiling).toBe(96700);
    expect(b.fifteenRateCeiling).toBe(600050);
  });

  it("throws on unknown tax year", () => {
    expect(() => lookupPreferentialBrackets(2099, "single")).toThrow(
      /No preferential-rate brackets/,
    );
  });
});
