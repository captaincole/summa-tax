import { derive, fact, derivation } from "../index";
import type { ScopingStatus } from "../../tax/artifacts/types";

export type OpenAsk = {
  factKey: string;
  prompt: string;
  origin: "calibration" | "intake" | "scoping" | "w2" | "engine";
  stage: "intake" | "document_gathering" | "reconciliation";
  // Open-asks sharing a batchGroup can be consolidated by Thom into a single
  // natural-language question when detail_mode allows it. Null means ask alone.
  batchGroup?: string;
};

// Each MVP ask names the fact key that resolves it, the human-readable
// prompt Thom can use verbatim, and the origin so the UI / observability
// can group by where it came from.
type AskSpec = OpenAsk & { isPresent: (facts: Record<string, unknown>) => boolean };

const hasFact = (key: string) => (facts: Record<string, unknown>) =>
  facts[key] !== undefined && facts[key] !== null;

// Calibration asks MUST be collected before anything else. They shape how
// Thom explains things (knowledge_level) and how many facts he packs into
// each question (detail_mode). Thom reads both every turn and adapts.
const CALIBRATION_ASKS: AskSpec[] = [
  {
    factKey: "preferences.knowledge_level",
    prompt:
      "Before we dig in — how comfortable are you with tax stuff? 1) beginner / first time, 2) intermediate / filed a few times, 3) advanced / I read personal finance for fun. No wrong answer.",
    origin: "calibration",
    stage: "intake",
    isPresent: hasFact("preferences.knowledge_level"),
  },
  {
    factKey: "preferences.detail_mode",
    prompt:
      "And how would you like me to pace things? 1) easy — I'll batch questions and keep it breezy, 2) intermediate — moderate pace with some detail, 3) advanced — one thing at a time, precise.",
    origin: "calibration",
    stage: "intake",
    isPresent: hasFact("preferences.detail_mode"),
  },
];

// MVP intake + scoping ask list. These are ordered roughly the way Thom
// should walk through them. A fact is "present" if the fact is set; if not,
// it's still open.
const INTAKE_ASKS: AskSpec[] = [
  {
    factKey: "tax_year",
    prompt: "What tax year are we working on? (MVP supports 2025.)",
    origin: "intake",
    stage: "intake",
    isPresent: hasFact("tax_year"),
  },
  {
    factKey: "identity.name.first",
    prompt: "What's your first name?",
    origin: "intake",
    stage: "intake",
    isPresent: hasFact("identity.name.first"),
  },
  {
    factKey: "identity.name.last",
    prompt: "And your last name?",
    origin: "intake",
    stage: "intake",
    isPresent: hasFact("identity.name.last"),
  },
  {
    factKey: "identity.filing_status",
    prompt: "How are you filing — single, married filing jointly, head of household?",
    origin: "intake",
    stage: "intake",
    isPresent: hasFact("identity.filing_status"),
  },
  {
    factKey: "identity.dependents_count",
    prompt: "Any dependents you'll claim on this return?",
    origin: "intake",
    stage: "intake",
    isPresent: hasFact("identity.dependents_count"),
  },
  {
    factKey: "residency.state",
    prompt: "What state did you live in during 2025?",
    origin: "intake",
    stage: "intake",
    isPresent: hasFact("residency.state"),
  },
  {
    factKey: "residency.full_year_in_state",
    prompt: "Did you live in that state for the full year?",
    origin: "intake",
    stage: "intake",
    isPresent: hasFact("residency.full_year_in_state"),
  },
  {
    factKey: "identity.ssn",
    prompt: "What's your SSN? (We need it for your filing.)",
    origin: "intake",
    stage: "intake",
    isPresent: hasFact("identity.ssn"),
  },
  {
    factKey: "identity.address",
    prompt: "And your current mailing address?",
    origin: "intake",
    stage: "intake",
    isPresent: hasFact("identity.address"),
  },
];

const SCOPING_ASKS: AskSpec[] = [
  {
    factKey: "wages.has_w2_income",
    prompt: "Do you have any W-2 income from an employer?",
    origin: "scoping",
    stage: "intake",
    isPresent: hasFact("wages.has_w2_income"),
  },
  {
    factKey: "mortgage.owns_home",
    prompt: "Do you own your home / have a mortgage?",
    origin: "scoping",
    stage: "intake",
    isPresent: hasFact("mortgage.owns_home"),
  },
  {
    factKey: "investment_income.has_accounts",
    prompt:
      "Do you have any investment or brokerage accounts outside your retirement account? (High-yield savings counts too.)",
    origin: "scoping",
    stage: "intake",
    batchGroup: "non-wage-income",
    isPresent: hasFact("investment_income.has_accounts"),
  },
  {
    factKey: "hsa.has_account",
    prompt: "Did you contribute to or take money from an HSA in 2025?",
    origin: "scoping",
    stage: "intake",
    isPresent: hasFact("hsa.has_account"),
  },
  {
    factKey: "self_employment.has_income",
    prompt: "Any freelance, contracting, or side-business income?",
    origin: "scoping",
    stage: "intake",
    batchGroup: "non-wage-income",
    isPresent: hasFact("self_employment.has_income"),
  },
  {
    factKey: "k1.has_k1",
    prompt: "Any K-1s from partnerships, S-corps, or trusts?",
    origin: "scoping",
    stage: "intake",
    batchGroup: "non-wage-income",
    isPresent: hasFact("k1.has_k1"),
  },
  {
    factKey: "rental.has_rental",
    prompt: "Any rental property income?",
    origin: "scoping",
    stage: "intake",
    batchGroup: "non-wage-income",
    isPresent: hasFact("rental.has_rental"),
  },
  {
    factKey: "foreign.has_accounts",
    prompt: "Any foreign accounts or foreign-sourced income?",
    origin: "scoping",
    stage: "intake",
    batchGroup: "non-wage-income",
    isPresent: hasFact("foreign.has_accounts"),
  },
  {
    factKey: "crypto.has_activity",
    prompt: "Any crypto or digital-asset activity in 2025?",
    origin: "scoping",
    stage: "intake",
    batchGroup: "non-wage-income",
    isPresent: hasFact("crypto.has_activity"),
  },
  {
    factKey: "charitable.has_giving",
    prompt: "Any charitable donations in 2025?",
    origin: "scoping",
    stage: "intake",
    isPresent: hasFact("charitable.has_giving"),
  },
];

// W-2 data asks — only asked once we know has_w2_income = true.
const W2_ASKS: AskSpec[] = [
  {
    factKey: "w2.box1",
    prompt: "Please upload your W-2, or tell me box 1 (wages).",
    origin: "w2",
    stage: "document_gathering",
    isPresent: hasFact("w2.box1"),
  },
];

export const openAsks = derive({
  id: "case.open_asks",
  description:
    "Ordered list of facts the MVP still needs. Thom reads this each turn to decide what to ask next.",
  inputs: {
    knowledgeLevel: fact<string | undefined>("preferences.knowledge_level"),
    detailMode: fact<string | undefined>("preferences.detail_mode"),
    taxYear: fact<number | undefined>("tax_year"),
    filingStatus: fact<string | undefined>("identity.filing_status"),
    firstName: fact<string | undefined>("identity.name.first"),
    lastName: fact<string | undefined>("identity.name.last"),
    ssn: fact<string | undefined>("identity.ssn"),
    addressRaw: fact<unknown>("identity.address"),
    dependents: fact<number | undefined>("identity.dependents_count"),
    state: fact<string | undefined>("residency.state"),
    fullYear: fact<boolean | undefined>("residency.full_year_in_state"),
    hasW2: fact<boolean | undefined>("wages.has_w2_income"),
    ownsHome: fact<boolean | undefined>("mortgage.owns_home"),
    hasInv: fact<boolean | undefined>("investment_income.has_accounts"),
    hasHSA: fact<boolean | undefined>("hsa.has_account"),
    hasSE: fact<boolean | undefined>("self_employment.has_income"),
    hasK1: fact<boolean | undefined>("k1.has_k1"),
    hasRental: fact<boolean | undefined>("rental.has_rental"),
    hasForeign: fact<boolean | undefined>("foreign.has_accounts"),
    hasCrypto: fact<boolean | undefined>("crypto.has_activity"),
    hasCharity: fact<boolean | undefined>("charitable.has_giving"),
    w2Box1: fact<number | undefined>("w2.box1"),
    mvp: derivation<{ withinMvp: boolean }>("mvp.scope_check"),
  },
  compute: (i): OpenAsk[] => {
    // If out of MVP, Thom should decline rather than continue asking.
    // Return empty so no further gathering is attempted.
    if (i.mvp.withinMvp === false) return [];

    const facts: Record<string, unknown> = {
      "preferences.knowledge_level": i.knowledgeLevel,
      "preferences.detail_mode": i.detailMode,
      tax_year: i.taxYear,
      "identity.filing_status": i.filingStatus,
      "identity.name.first": i.firstName,
      "identity.name.last": i.lastName,
      "identity.ssn": i.ssn,
      "identity.address": i.addressRaw,
      "identity.dependents_count": i.dependents,
      "residency.state": i.state,
      "residency.full_year_in_state": i.fullYear,
      "wages.has_w2_income": i.hasW2,
      "mortgage.owns_home": i.ownsHome,
      "investment_income.has_accounts": i.hasInv,
      "hsa.has_account": i.hasHSA,
      "self_employment.has_income": i.hasSE,
      "k1.has_k1": i.hasK1,
      "rental.has_rental": i.hasRental,
      "foreign.has_accounts": i.hasForeign,
      "crypto.has_activity": i.hasCrypto,
      "charitable.has_giving": i.hasCharity,
      "w2.box1": i.w2Box1,
    };

    const asks: OpenAsk[] = [];

    // Calibration MUST come first — Thom can't adapt his tone / pacing
    // until both preferences are recorded.
    for (const spec of [...CALIBRATION_ASKS, ...INTAKE_ASKS, ...SCOPING_ASKS]) {
      if (!spec.isPresent(facts)) {
        const { isPresent: _, ...ask } = spec;
        asks.push(ask);
      }
    }

    // Only ask for W-2 data if we've confirmed has_w2_income = true
    if (i.hasW2 === true) {
      for (const spec of W2_ASKS) {
        if (!spec.isPresent(facts)) {
          const { isPresent: _, ...ask } = spec;
          asks.push(ask);
        }
      }
    }

    return asks;
  },
});

// Progress-across-dimensions summary Thom can reference.
export type CaseProgress = {
  intakePct: number;
  scopingPct: number;
  docsPct: number;
  overallPct: number;
};

export const caseProgress = derive({
  id: "case.progress",
  description:
    "Percent-complete across the intake / scoping / document-gathering dimensions.",
  inputs: {
    asks: derivation<OpenAsk[]>("case.open_asks"),
  },
  compute: ({ asks }): CaseProgress => {
    // Calibration rolls into the "intake" dimension — they're both setup
    // questions before the real tax work begins.
    const TOTAL_INTAKE = CALIBRATION_ASKS.length + INTAKE_ASKS.length;
    const TOTAL_SCOPING = SCOPING_ASKS.length;
    const TOTAL_DOCS = W2_ASKS.length;

    const openIntake = asks.filter(
      (a) => a.origin === "intake" || a.origin === "calibration",
    ).length;
    const openScoping = asks.filter((a) => a.origin === "scoping").length;
    const openDocs = asks.filter((a) => a.origin === "w2").length;

    const intakePct = Math.round(((TOTAL_INTAKE - openIntake) / TOTAL_INTAKE) * 100);
    const scopingPct = Math.round(((TOTAL_SCOPING - openScoping) / TOTAL_SCOPING) * 100);
    const docsPct = TOTAL_DOCS === 0 ? 100 : Math.round(((TOTAL_DOCS - openDocs) / TOTAL_DOCS) * 100);
    const overallPct = Math.round((intakePct + scopingPct + docsPct) / 3);

    return { intakePct, scopingPct, docsPct, overallPct };
  },
});
