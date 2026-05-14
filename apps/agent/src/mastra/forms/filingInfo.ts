// FilingInfo — the typed boundary between AI-resolved values and form bindings.
//
// Three layers:
//   1. BaseFilingInfo (this file) — slots EVERY form needs: taxpayer
//      identity (name / SSN / address) plus the small set of scope
//      decisions that span jurisdictions (filingStatus).
//   2. <Form>FilingInfo (per-form files, e.g. forms/federal/1040/filingInfo.ts)
//      — extends BaseFilingInfo with slots specific to one form. Each form's
//      bindings import their narrow type and TS rejects misreads.
//   3. FilingInfo (this file) — the runtime intersection of every per-form
//      type. The resolver produces this; the engine carries it on
//      DerivationContext.filingInfo. Individual bindings see only their
//      narrower view via their function signature.
//
// Adding a new slot:
//   - Identity / cross-form scope → BaseFilingInfo here.
//   - Form-specific → that form's filingInfo.ts. Update the FilingInfo
//     intersection at the bottom of this file so the resolver returns the
//     wider shape. TS will flag any binding that depends on a stale shape.

import {
  ssn,
  phone,
  type FilingStatus,
  type SSN,
  type Phone,
} from "./values.js";
import type { Form1040FilingInfo } from "./federal/1040/filingInfo.js";
import type { Form540FilingInfo } from "./state/ca/540/filingInfo.js";

// ─── Base (shared across every form) ─────────────────────────────────────

export interface BaseFilingInfo {
  // ─── Scope decisions used by multiple forms ──────────────────────────
  /** Single / MFJ / MFS / HOH / QSS. Drives standard-deduction + tax-table lookups on every jurisdiction's form. */
  filingStatus?: FilingStatus;

  // ─── Taxpayer identity ───────────────────────────────────────────────
  taxpayerFirstName?: string;
  taxpayerMiddleInitial?: string;
  taxpayerLastName?: string;
  taxpayerSSN?: SSN;
  taxpayerDateOfBirth?: string; // ISODate when we add a brand for it
  taxpayerOccupation?: string;
  taxpayerPhone?: Phone;
  taxpayerEmail?: string;

  // ─── Spouse (MFJ / MFS) ──────────────────────────────────────────────
  spouseFirstName?: string;
  spouseMiddleInitial?: string;
  spouseLastName?: string;
  spouseSSN?: SSN;
  spouseOccupation?: string;

  // ─── Home address ────────────────────────────────────────────────────
  homeAddressLine1?: string;
  homeAddressApt?: string;
  homeAddressCity?: string;
  homeAddressState?: string;
  homeAddressZip?: string;
  homeAddressCounty?: string;

  // ─── Health coverage ─────────────────────────────────────────────────
  /**
   * Taxpayer had minimum essential coverage every month of the tax year.
   * Federal 1040 doesn't have a dedicated line for this in 2025 but the
   * CA 540 (line 92) does, and other state forms may. Lives on base so
   * any form's binding can read it.
   */
  fullYearMEC?: boolean;
}

// ─── Runtime intersection (every form's view, all slots present) ─────────

/**
 * The combined shape the resolver produces and the engine carries on
 * DerivationContext.filingInfo. Intersection of every per-form FilingInfo,
 * so it's assignable to any narrower per-form type at the binding boundary.
 */
export type FilingInfo = BaseFilingInfo & Form1040FilingInfo & Form540FilingInfo;

// ─── Resolver (hand-coded stand-in for the AI layer) ─────────────────────

/**
 * Build FilingInfo from raw facts + decisions. Pure function: same inputs
 * → same output. Eventually replaced by an Anthropic-backed resolver that
 * produces the same shape from less-structured inputs (uploaded PDFs,
 * conversation transcripts).
 *
 * For the migration we keep the hand-coded resolver so Alex's offline
 * integration test passes without an LLM in the loop.
 */
export function resolveFilingInfo(opts: {
  facts: ReadonlyArray<{ key: string; value: unknown; category: string }>;
  decisions: ReadonlyArray<{ decisionKey: string; decision: unknown }>;
}): FilingInfo {
  const factByKey = new Map<string, unknown>();
  for (const f of opts.facts) factByKey.set(f.key, f.value);

  const factsInCategory = (cat: string): Array<{ key: string; value: unknown }> =>
    opts.facts.filter((f) => f.category === cat);

  const decisionByKey = new Map<string, unknown>();
  for (const d of opts.decisions) decisionByKey.set(d.decisionKey, d.decision);

  const text = (key: string): string | undefined => {
    const v = factByKey.get(key);
    return typeof v === "string" ? v : undefined;
  };

  const sumW2Box = (boxKey: string): number => {
    const rows = factsInCategory("wages");
    let total = 0;
    for (const row of rows) {
      const v = (row.value as Record<string, unknown>)?.[boxKey];
      if (typeof v === "number" && Number.isFinite(v)) total += v;
    }
    return total;
  };

  // Sum a numeric field across all 1099-DIV / investment_income facts.
  // Returns 0 when no facts exist — same convention as sumW2Box, which
  // means "taxpayer has no 1099-DIV at all → 0 dividends" rather than
  // "we don't know, leave blank." That's the FTB / IRS convention for
  // these lines.
  const sumInvestmentBox = (boxKey: string): number => {
    const rows = factsInCategory("investment_income");
    let total = 0;
    for (const row of rows) {
      const v = (row.value as Record<string, unknown>)?.[boxKey];
      if (typeof v === "number" && Number.isFinite(v)) total += v;
    }
    return total;
  };

  const filingStatusRaw = decisionByKey.get("decisions.scope.filing_status");
  const filingStatus =
    filingStatusRaw === "single" ||
    filingStatusRaw === "married_filing_jointly" ||
    filingStatusRaw === "married_filing_separately" ||
    filingStatusRaw === "head_of_household" ||
    filingStatusRaw === "qualifying_surviving_spouse"
      ? filingStatusRaw
      : undefined;

  const ssnRaw = text("identity.ssn");
  const phoneRaw = text("identity.phone");

  return {
    // ─── Base ───────────────────────────────────────────────────────
    filingStatus,
    taxpayerFirstName: text("identity.name.first"),
    taxpayerMiddleInitial: text("identity.name.middle_initial"),
    taxpayerLastName: text("identity.name.last"),
    // Constructors strip separators + validate digit count; canonical
    // storage in the FilingInfo slot is bare digits.
    taxpayerSSN: ssnRaw ? ssn(ssnRaw) : undefined,
    taxpayerDateOfBirth: text("identity.dob"),
    taxpayerOccupation: text("identity.occupation"),
    taxpayerPhone: phoneRaw ? phone(phoneRaw) : undefined,
    taxpayerEmail: text("identity.email"),
    homeAddressLine1: text("identity.address.street"),
    homeAddressApt: text("identity.address.apt"),
    homeAddressCity: text("identity.address.city"),
    homeAddressState: text("identity.address.state"),
    homeAddressZip: text("identity.address.zip"),
    homeAddressCounty: text("identity.address.county"),

    // ─── Form 1040 ──────────────────────────────────────────────────
    mustFileFederal: decisionByKey.get("decisions.scope.must_file_federal") as
      | boolean
      | undefined,
    w2WagesTotal: sumW2Box("box1") as Form1040FilingInfo["w2WagesTotal"],
    w2FederalWithholding: sumW2Box("box2") as Form1040FilingInfo["w2FederalWithholding"],
    qualifiedDividends: sumInvestmentBox(
      "box1b",
    ) as Form1040FilingInfo["qualifiedDividends"],
    ordinaryDividends: sumInvestmentBox(
      "box1a",
    ) as Form1040FilingInfo["ordinaryDividends"],
    form1099FederalWithholding: sumInvestmentBox(
      "box4",
    ) as Form1040FilingInfo["form1099FederalWithholding"],
    refundFullOverpaymentFederal: decisionByKey.get(
      "decisions.refund.refund_full_overpayment_federal",
    ) as boolean | undefined,
    fullYearMEC: factByKey.get("health_coverage.full_year_mec") as boolean | undefined,

    // ─── Form 540 (CA) ──────────────────────────────────────────────
    mustFileCA540: decisionByKey.get("decisions.scope.must_file_ca_540") as
      | boolean
      | undefined,
    caResidencyStatus: decisionByKey.get("decisions.scope.ca_residency") as
      | string
      | undefined,
    w2StateWages: sumW2Box("box16") as Form540FilingInfo["w2StateWages"],
    w2StateWithholding: sumW2Box("box17") as Form540FilingInfo["w2StateWithholding"],
    w2CaSdiTotal: sumCaSdi(factsInCategory("wages")) as Form540FilingInfo["w2CaSdiTotal"],
    useTaxOwed:
      typeof factByKey.get("use_tax.owed_amount") === "number"
        ? (factByKey.get("use_tax.owed_amount") as Form540FilingInfo["useTaxOwed"])
        : undefined,
    noUseTaxOwed:
      decisionByKey.get("decisions.scope.use_tax_zero_reason") === "no_use_tax_owed"
        ? true
        : undefined,
    useTaxZeroReason: (() => {
      const v = decisionByKey.get("decisions.scope.use_tax_zero_reason");
      return typeof v === "string" ? v : undefined;
    })(),
    mailingSameAsResidence: decisionByKey.get(
      "decisions.scope.mailing_same_as_principal_residence",
    ) as boolean | undefined,
    refundFullOverpaymentCA: decisionByKey.get(
      "decisions.refund.refund_full_overpayment_ca",
    ) as boolean | undefined,
  };
}

function sumCaSdi(wageRows: Array<{ value: unknown }>): number {
  let total = 0;
  for (const row of wageRows) {
    const box14 = (row.value as Record<string, unknown>)?.box14;
    if (!Array.isArray(box14)) continue;
    for (const entry of box14) {
      const label = (entry as Record<string, unknown>)?.label;
      const amount = (entry as Record<string, unknown>)?.amount;
      if (
        typeof label === "string" &&
        /CA\s*SDI/i.test(label) &&
        typeof amount === "number" &&
        Number.isFinite(amount)
      ) {
        total += amount;
      }
    }
  }
  return total;
}
