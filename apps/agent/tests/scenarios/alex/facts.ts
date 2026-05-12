// Alex Morales — facts (the "data").
//
// Sourced from `apps/agent/fixtures/docs/01-alex-w2.pdf` (Brightside
// Logistics W-2). Box 1 ($79,000) sits below box 3/5 ($85,000) because of
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
  box1: 79_000,
  box2: 9_420,
  box3: 85_000,
  box4: 5_270,
  box5: 85_000,
  box6: 1_232.5,
  box12: [{ code: "D", amount: 6_000 }],
  box13: { retirementPlan: true },
  box14: [{ label: "CA SDI", amount: 935 }],
  box15: "CA",
  box16: 79_000,
  box17: 3_100,
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
  idFact("dob", "06/15/1986"),
  idFact("address.street", "2245 Lakeshore Ave"),
  idFact("address.apt", "Apt 3"),
  idFact("address.city", "Oakland"),
  idFact("address.state", "CA"),
  idFact("address.zip", "94606"),
  idFact("occupation", "Engineer"),
  idFact("phone", "703-953-0253"),
  idFact("email", "rand@wheeloftime.com"),
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
];
