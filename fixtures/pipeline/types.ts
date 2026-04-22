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

export type DocumentSpec = W2Document

export type ScenarioSpec = {
  id: string
  taxYear: number
  taxpayer: Taxpayer
  documents: DocumentSpec[]
}
