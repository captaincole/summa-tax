import type { Derivation } from "../types";
import {
  totalWages,
  totalFederalWithholding,
  totalStateWithholding,
  agi,
  taxableIncome,
  federalTaxOwed,
  refundOrBalanceDue,
} from "./money";
import {
  standardDeduction,
  totalItemizableDeductions,
  itemizeVsStandard,
} from "./deductions";
import { saversCreditEligibility } from "./credits";
import { draft1040 } from "./draft1040";
import { openAsks, caseProgress } from "./openAsks";

// All Alex-scenario derivations registered for the engine. Order doesn't
// matter — the topo sort in engine.ts orders them by dependency.
export const alexDerivations: Derivation[] = [
  totalWages,
  totalFederalWithholding,
  totalStateWithholding,
  agi,
  taxableIncome,
  federalTaxOwed,
  refundOrBalanceDue,
  standardDeduction,
  totalItemizableDeductions,
  itemizeVsStandard,
  saversCreditEligibility,
  draft1040,
  openAsks,
  caseProgress,
];

export type { RefundOrBalance } from "./money";
export type { ItemizeDecision } from "./deductions";
export type { SaversCreditResult } from "./credits";
export type { Draft1040, DraftLine } from "./draft1040";
export type { OpenAsk, CaseProgress } from "./openAsks";
export type { FilingStatus } from "./tables";
