// W-2 fact kind. Each W-2 the taxpayer received is stored as one tax_facts
// row under category "wages" with a structured value containing all the
// boxes plus employer metadata.
//
// Convention:
//   category: "wages"
//   key:      "employer.{employerSlug}"
//   value:    W2FactValue

import type { FactsView } from "../../engine/types.js";
import type { TaxFactRow } from "../../db/taxFacts.js";

export interface W2Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  zip: string;
}

export interface W2Box12Entry {
  code: string;
  amount: number;
}

export interface W2Box14Entry {
  label: string;
  amount: number;
}

export interface W2FactValue {
  employerName: string;
  employerEin: string;
  employerAddress?: W2Address;
  // Employee identity — boxes (a) SSN, (e) name, (f) address. Captured here
  // so a single W-2 ingest also populates the taxpayer's identity facts;
  // the Luca flow doesn't need to re-ask for name/SSN/address.
  employee?: {
    firstName: string;
    middleInitial?: string;
    lastName: string;
    suffix?: string;
    ssn: string;
    address?: W2Address;
  };
  // Numeric boxes — required ones first, optional ones below.
  box1: number;
  box2: number;
  box3?: number;
  box4?: number;
  box5?: number;
  box6?: number;
  box7?: number;
  box8?: number;
  box10?: number;
  box11?: number;
  box12?: W2Box12Entry[];
  box13?: {
    statutoryEmployee?: boolean;
    retirementPlan?: boolean;
    thirdPartySickPay?: boolean;
  };
  box14?: W2Box14Entry[];
  box15?: string;          // state
  box16?: number;          // state wages
  box17?: number;          // state income tax
}

export interface W2Fact {
  employerSlug: string;
  w2: W2FactValue;
  sourceFact: TaxFactRow;
}

const W2_CATEGORY = "wages";
const W2_KEY_RE = /^employer\.([^.]+)$/;

export function makeW2FactKey(employerSlug: string): string {
  return `employer.${employerSlug}`;
}

export function isW2Fact(f: TaxFactRow): boolean {
  return f.category === W2_CATEGORY && W2_KEY_RE.test(f.key);
}

export function parseW2Fact(f: TaxFactRow): W2Fact | null {
  if (f.category !== W2_CATEGORY) return null;
  const match = f.key.match(W2_KEY_RE);
  if (!match) return null;
  const [, employerSlug] = match;
  return {
    employerSlug,
    w2: f.value as W2FactValue,
    sourceFact: f,
  };
}

export function getW2Facts(facts: FactsView): W2Fact[] {
  const out: W2Fact[] = [];
  for (const f of facts.byCategory(W2_CATEGORY)) {
    const parsed = parseW2Fact(f);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}
