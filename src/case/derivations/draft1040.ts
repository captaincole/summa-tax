import { derive, derivation, fact } from "../index";
import type { ItemizeDecision } from "./deductions";
import type { RefundOrBalance } from "./money";
import type { FilingStatus } from "./tables";

// A "draft 1040" — every line we can populate from current facts,
// annotated with provenance. Lines we can't fill yet have `value: null`
// so the UI can show placeholders and Thom can see what's still missing.

export type DraftLine = {
  key: string;            // e.g. "1a", "11", "16"
  label: string;          // plain-English label
  value: string | number | null;
  source?: string;        // citation — "W-2 box 1", "derived from ...", etc.
};

export type Draft1040 = {
  year: number | null;
  filingStatus: FilingStatus | null;
  identityHeader: {
    name: string | null;
    ssn: string | null;
    address: string | null;
  };
  lines: DraftLine[];
  populated: number;
  totalLines: number;
  progressPct: number;
};

const fmtAddress = (addr: unknown): string | null => {
  if (!addr || typeof addr !== "object") return null;
  const a = addr as Record<string, unknown>;
  const line1 = a.line1 ?? a.street;
  const city = a.city;
  const state = a.state;
  const zip = a.zip;
  if (!line1 || !city || !state || !zip) return null;
  return `${line1}, ${city}, ${state} ${zip}`;
};

export const draft1040 = derive({
  id: "forms.draft_1040",
  description:
    "Best-effort Form 1040 draft built from known facts. Lines with null values are pending.",
  inputs: {
    taxYear: fact<number | undefined>("tax_year"),
    filingStatus: fact<FilingStatus | undefined>("identity.filing_status"),
    firstName: fact<string | undefined>("identity.name.first"),
    lastName: fact<string | undefined>("identity.name.last"),
    ssn: fact<string | undefined>("identity.ssn"),
    addressRaw: fact<unknown>("identity.address"),

    wages: derivation<number>("money.total_wages"),
    agi: derivation<number>("money.agi"),
    standardDeduction: derivation<number>("deductions.standard_deduction"),
    itemize: derivation<ItemizeDecision>("decisions.itemize_vs_standard"),
    taxableIncome: derivation<number>("money.taxable_income"),
    federalTaxOwed: derivation<number>("money.federal_tax_owed"),
    federalWithholding: derivation<number>("money.total_federal_withholding"),
    refundOrBalance: derivation<RefundOrBalance>("money.refund_or_balance_due"),
  },
  compute: (i): Draft1040 => {
    const lines: DraftLine[] = [];

    lines.push({
      key: "1a",
      label: "Total W-2 wages",
      value: i.wages > 0 ? i.wages : null,
      source: i.wages > 0 ? "Sum of W-2 box 1" : undefined,
    });

    lines.push({
      key: "11",
      label: "Adjusted gross income",
      value: i.wages > 0 ? i.agi : null,
      source: "AGI = wages (MVP: no adjustments)",
    });

    const deductionChosen =
      i.itemize.decision === "itemize" ? i.itemize.itemizedTotal : i.standardDeduction;
    lines.push({
      key: "12",
      label:
        i.itemize.decision === "itemize"
          ? "Itemized deductions"
          : "Standard deduction",
      value: i.standardDeduction > 0 ? deductionChosen : null,
      source: i.itemize.rationale,
    });

    lines.push({
      key: "15",
      label: "Taxable income",
      value: i.wages > 0 && i.standardDeduction > 0 ? i.taxableIncome : null,
      source: "Line 11 − Line 12",
    });

    lines.push({
      key: "16",
      label: "Federal income tax",
      value:
        i.wages > 0 && i.standardDeduction > 0 ? i.federalTaxOwed : null,
      source: "Bracketed rates applied to taxable income",
    });

    lines.push({
      key: "25a",
      label: "Federal income tax withheld (from W-2)",
      value: i.federalWithholding > 0 ? i.federalWithholding : null,
      source: i.federalWithholding > 0 ? "Sum of W-2 box 2" : undefined,
    });

    const refundFilled = i.wages > 0 && i.standardDeduction > 0;
    if (refundFilled && i.refundOrBalance.direction === "refund") {
      lines.push({
        key: "34",
        label: "Amount overpaid (refund)",
        value: i.refundOrBalance.amount,
        source: "Withholding − Tax owed",
      });
    } else if (refundFilled && i.refundOrBalance.direction === "balance_due") {
      lines.push({
        key: "37",
        label: "Amount you owe",
        value: i.refundOrBalance.amount,
        source: "Tax owed − Withholding",
      });
    } else {
      lines.push({
        key: "34/37",
        label: "Refund or balance due",
        value: null,
        source: "Pending — needs tax computation",
      });
    }

    const populated = lines.filter((l) => l.value !== null).length;
    const totalLines = lines.length;
    const progressPct = totalLines > 0 ? Math.round((populated / totalLines) * 100) : 0;

    const fullName =
      i.firstName && i.lastName ? `${i.firstName} ${i.lastName}` : null;

    return {
      year: i.taxYear ?? null,
      filingStatus: i.filingStatus ?? null,
      identityHeader: {
        name: fullName,
        ssn: i.ssn ?? null,
        address: fmtAddress(i.addressRaw),
      },
      lines,
      populated,
      totalLines,
      progressPct,
    };
  },
});
