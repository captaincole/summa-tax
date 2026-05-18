// Alex Morales — facts (the "data").
//
// Sourced from `apps/agent/tests/scenarios/alex/docs/01-alex-w2.pdf`
// (Brightside Logistics W-2). Box 1 ($79,000) sits below box 3/5 ($85,000) because of
// the $6,000 traditional 401(k) in box 12a code D. Identity facts are
// what Thom captures during intake (occupation/phone/email aren't on the
// W-2 — they come from the conversation; identity.email is auto-sourced
// from Supabase auth at doc-gen time).

import type { TaxFactRow } from "../../../src/mastra/db/taxFacts.js";
import { makeW2FactKey, type W2FactValue } from "../../../src/mastra/facts/index.js";
import { identityFact } from "../../helpers/fixtureBuilders.js";

export const ALEX_USER_ID = "alex-integration";
export const ALEX_TAX_YEAR = 2025;

const w2: W2FactValue = {
  employerName: "Brightside Logistics, Inc.",
  employerEin: "36-1234567",
  employerAddress: {
    line1: "1800 Embarcadero",
    city: "Oakland",
    state: "CA",
    zip: "94606",
  },
  box1: 79000,
  box2: 9420,
  box3: 85000,
  box4: 5270,
  box5: 85000,
  box6: 1232.5,
  box12: [{ code: "D", amount: 6000 }],
  box13: { retirementPlan: true },
  box14: [{ label: "CA SDI", amount: 935 }],
  box15: "CA",
  box16: 79000,
  box17: 3100,
};

const idFact = (suffix: string, value: string) =>
  identityFact({
    userId: ALEX_USER_ID,
    taxYear: ALEX_TAX_YEAR,
    suffix,
    value,
  });

export const alexFacts: TaxFactRow[] = [
  idFact("name.first", "Alex"),
  idFact("name.last", "Morales"),
  idFact("ssn", "123-45-6789"),
  idFact("dob", "01/01/2002"),
  idFact("address.street", "2245 Lakeshore Ave"),
  idFact("address.apt", "Apt 3"),
  idFact("address.city", "Oakland"),
  idFact("address.state", "CA"),
  idFact("address.zip", "94606"),
  idFact("address.county", "Alameda"),
  idFact("occupation", "Engineer"),
  idFact("phone", "703-953-0253"),
  idFact("email", "alex@morales.com"),
  {
    id: "f-w2",
    userId: ALEX_USER_ID,
    taxYear: ALEX_TAX_YEAR,
    category: "wages",
    key: makeW2FactKey("brightside-logistics"),
    value: w2,
    sourceNote: "W-2 from Brightside Logistics, Inc.",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-mec",
    userId: ALEX_USER_ID,
    taxYear: ALEX_TAX_YEAR,
    category: "health_coverage",
    key: "health_coverage.full_year_mec",
    value: true,
    sourceNote: "Verbal confirmation during intake — employer-provided plan covered all 12 months of 2025.",
    createdAt: "2026-04-29T00:00:00Z",
  },
  {
    id: "f-use-tax",
    userId: ALEX_USER_ID,
    taxYear: ALEX_TAX_YEAR,
    category: "use_tax",
    key: "use_tax.owed_amount",
    value: 0,
    sourceNote: "Verbal confirmation during intake — no out-of-state online purchases requiring use tax.",
    createdAt: "2026-04-29T00:00:00Z",
  },
];
