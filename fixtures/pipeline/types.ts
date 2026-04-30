export type Address = {
  line1: string
  line2?: string
  city: string
  state: string
  zip: string
}

export type Taxpayer = {
  name: { first: string; middle?: string; last: string }
  ssn: string
  address: Address
}

export type Box12Code =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H"
  | "J" | "K" | "L" | "M" | "N" | "P" | "Q" | "R"
  | "S" | "T" | "V" | "W" | "Y" | "Z"
  | "AA" | "BB" | "CC" | "DD" | "EE" | "FF" | "GG" | "HH"

export type W2Box12Entry = { code: Box12Code; amount: number }
export type W2Box14Entry = { label: string; amount: number }

export type W2Document = {
  kind: "W-2"
  outputFilename: string
  employer: {
    name: string
    ein: string
    address: Address
  }
  boxes: {
    box1: number
    box2: number
    box3: number
    box4: number
    box5: number
    box6: number
    box7?: number
    box8?: number
    box10?: number
    box11?: number
    box12?: W2Box12Entry[]
    box13?: {
      statutoryEmployee?: boolean
      retirementPlan?: boolean
      thirdPartySickPay?: boolean
    }
    box14?: W2Box14Entry[]
    box15: string
    box16: number
    box17: number
  }
}

// ─── Consolidated 1099 ─────────────────────────────────────────────────────
// Real brokerages issue a single multi-section "Consolidated 1099 Tax
// Statement" rather than separate per-form 1099-DIV / 1099-INT / etc.
// Sections are independently optional — a section that's "present but
// empty" still gets a box-by-box render with $0.00 values, which is how
// brokers actually print these.

export type Form1099Payer = {
  name: string
  address: Address
  tin: string         // Federal Identification Number printed on the form
  phone?: string
}

export type Form1099DivBoxes = {
  box1a?: number  // Total Ordinary Dividends
  box1b?: number  // Qualified Dividends
  box2a?: number  // Total Capital Gain Distributions
  box2b?: number  // Unrecap. Sec. 1250 Gain
  box2d?: number  // Collectibles (28%) Gain
  box2e?: number  // Section 897 Ordinary Dividends
  box2f?: number  // Section 897 Capital Gain
  box3?: number   // Non-Dividend Distributions
  box4?: number   // Federal Income Tax Withheld
  box5?: number   // Section 199A Dividends
  box6?: number   // Investment Expenses
  box7?: number   // Foreign Tax Paid
  box9?: number   // Cash Liquidation Distributions
  box10?: number  // Non-Cash Liquidation Distributions
  box12?: number  // Exempt-Interest Dividends
  box13?: number  // Specified Private Activity Bond Interest Dividends
}

export type Form1099IntBoxes = {
  box1?: number   // Interest Income
  box2?: number   // Early Withdrawal Penalty
  box3?: number   // Interest on US Savings Bonds and Treas. Obligations
  box4?: number   // Federal Income Tax Withheld
  box5?: number   // Investment Expenses
  box6?: number   // Foreign Tax Paid
  box8?: number   // Tax-Exempt Interest
  box9?: number   // Specified Private Activity Bond Interest
  box10?: number  // Market Discount
  box11?: number  // Bond Premium
  box12?: number  // Bond Premium on Treasury Obligations
  box13?: number  // Bond Premium on Tax-Exempt Bond
}

export type Form1099MiscBoxes = {
  box1?: number   // Rents
  box2?: number   // Royalties
  box3?: number   // Other Income
  box4?: number   // Federal Income Tax Withheld
  box8?: number   // Substitute Payments in Lieu of Dividends or Interest
}

export type Form1099OidBoxes = {
  box1?: number   // Original Issue Discount
  box2?: number   // Other Periodic Interest
  box4?: number   // Federal Income Tax Withheld
  box5?: number   // Market Discount
  box6?: number   // Acquisition Premium
  box8?: number   // OID on US Treasury Obligations
  box9?: number   // Investment Expenses
  box10?: number  // Bond Premium
  box11?: number  // Tax-Exempt OID
}

export type Form1099BBoxes = {
  proceeds?: number              // Box 1d total
  proceedsCovered?: number       // sub-line of box 1d
  proceedsNoncovered?: number    // sub-line of box 1d
  costBasisCovered?: number      // Box 1e
  accruedMarketDiscount?: number // Box 1f
  washSaleLossDisallowed?: number // Box 1g
  federalIncomeTaxWithheld?: number // Box 4
}

export type DividendDetailLine = {
  description: string             // e.g. "VANGUARD S&P 500 ETF"
  cusip?: string
  payDate: string                 // MM/DD/YY as printed
  ordinaryDividends?: number
  qualifiedDividends?: number
  federalIncomeTaxWithheld?: number
  section199ADividends?: number
}

// 1099-B trade detail. `section` discriminates which Form 8949 box the trade
// rolls up to:
//   long-covered   → Form 8949 Part II, Box D (LT basis reported)
//   long-noncovered→ Form 8949 Part II, Box E (LT basis NOT reported)
//   short-covered  → Form 8949 Part I,  Box A (ST basis reported)
//   short-noncovered → Form 8949 Part I, Box B (ST basis NOT reported)
export type TradeSection =
  | "long-covered"
  | "long-noncovered"
  | "short-covered"
  | "short-noncovered"

export type TradeDetailLine = {
  section: TradeSection
  description: string             // e.g. "APPLE INC"
  cusip?: string
  symbol?: string                 // ticker, for display
  quantity: number
  dateAcquired: string            // MM/DD/YY
  dateSold: string                // MM/DD/YY
  proceeds: number                // Box 1d
  costBasis?: number              // Box 1e — may be absent for noncovered
  accruedMarketDiscount?: number  // Box 1f
  washSaleLossDisallowed?: number // Box 1g
  gainLoss: number                // signed; can be negative for losses
  federalIncomeTaxWithheld?: number // Box 4
}

export type Form1099ConsolidatedDocument = {
  kind: "1099-Consolidated"
  outputFilename: string
  payer: Form1099Payer
  accountNumber: string
  div?: Form1099DivBoxes
  int?: Form1099IntBoxes
  misc?: Form1099MiscBoxes
  oid?: Form1099OidBoxes
  b?: Form1099BBoxes
  // Per-payment breakdown that prints on the detail page after the summary.
  divDetail?: DividendDetailLine[]
  bDetail?: TradeDetailLine[]
}

export type DocumentSpec = W2Document | Form1099ConsolidatedDocument

export type ScenarioSpec = {
  id: string
  taxYear: number
  taxpayer: Taxpayer
  documents: DocumentSpec[]
}
