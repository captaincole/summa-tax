import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"
import type {
  Address,
  DividendDetailLine,
  Form1099BBoxes,
  Form1099ConsolidatedDocument,
  Form1099DivBoxes,
  Form1099IntBoxes,
  Form1099MiscBoxes,
  Form1099OidBoxes,
  Taxpayer,
  TradeDetailLine,
  TradeSection,
} from "../types.js"

// Generic consolidated 1099 layout. Models the "Copy B For Recipient" page
// that real brokerages issue + a 1099-DIV detail page when divDetail is
// provided. Other section detail pages (INT / B / etc.) get added when their
// data shapes start landing in scenarios.

const PAGE_W = 612    // US Letter
const PAGE_H = 792
const MARGIN = 36

const BLACK = rgb(0, 0, 0)
// Subtle gray for section-header bands and table-header zones; matches the
// near-white shading real broker statements use rather than tinted blue.
const HEADER_SHADE = rgb(0.94, 0.94, 0.94)
// Slightly darker for warning/callout boxes on the cover page.
const CALLOUT_SHADE = rgb(0.97, 0.92, 0.86)

type DrawCtx = {
  page: PDFPage
  font: PDFFont
  fontBold: PDFFont
}

const ty = (topY: number): number => PAGE_H - topY

const fmtMoney = (n: number | undefined): string =>
  `$${(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtAddress = (a: Address): string[] =>
  [a.line1, a.line2, `${a.city}, ${a.state} ${a.zip}`].filter(Boolean) as string[]

// Mask all but the last four digits of an SSN — standard practice on 1099s.
const maskSsn = (ssn: string): string => `XXX-XX-${ssn.slice(-4)}`

const rect = (
  ctx: DrawCtx,
  x: number,
  topY: number,
  w: number,
  h: number,
  opts: { fill?: ReturnType<typeof rgb>; stroke?: boolean; thickness?: number } = {},
): void => {
  ctx.page.drawRectangle({
    x,
    y: ty(topY + h),
    width: w,
    height: h,
    borderColor: opts.stroke === false ? undefined : BLACK,
    borderWidth: opts.stroke === false ? 0 : (opts.thickness ?? 0.5),
    color: opts.fill,
  })
}

const text = (
  ctx: DrawCtx,
  x: number,
  topY: number,
  str: string,
  opts: { size?: number; bold?: boolean; align?: "left" | "right" | "center"; maxWidth?: number } = {},
): void => {
  const size = opts.size ?? 7
  const font = opts.bold ? ctx.fontBold : ctx.font
  let drawX = x
  if (opts.align === "right" && opts.maxWidth !== undefined) {
    const w = font.widthOfTextAtSize(str, size)
    drawX = x + opts.maxWidth - w
  } else if (opts.align === "center" && opts.maxWidth !== undefined) {
    const w = font.widthOfTextAtSize(str, size)
    drawX = x + (opts.maxWidth - w) / 2
  }
  ctx.page.drawText(str, { x: drawX, y: ty(topY + size), size, font, color: BLACK })
}

const hLine = (ctx: DrawCtx, x1: number, x2: number, topY: number, thickness = 0.3): void => {
  ctx.page.drawLine({
    start: { x: x1, y: ty(topY) },
    end: { x: x2, y: ty(topY) },
    color: BLACK,
    thickness,
  })
}

// Word-wrap a string into lines that fit within maxWidth at the given size.
// Greedy line-fill; preserves the original word order. Long words that don't
// fit alone are emitted on their own line and may overflow.
const wrapText = (str: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const words = str.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w
    if (font.widthOfTextAtSize(candidate, size) > maxWidth) {
      if (current) lines.push(current)
      current = w
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

// Draw a paragraph of wrapped text. Returns the y-coordinate immediately
// below the last drawn line.
const drawParagraph = (
  ctx: DrawCtx,
  x: number,
  topY: number,
  str: string,
  opts: { size?: number; bold?: boolean; maxWidth: number; lineHeight?: number },
): number => {
  const size = opts.size ?? 7.5
  const lineHeight = opts.lineHeight ?? size + 2
  const font = opts.bold ? ctx.fontBold : ctx.font
  const lines = wrapText(str, font, size, opts.maxWidth)
  lines.forEach((line, i) => {
    text(ctx, x, topY + i * lineHeight, line, { size, bold: opts.bold })
  })
  return topY + lines.length * lineHeight
}

// ─── Section / box-row primitives ───────────────────────────────────────

type BoxRow = {
  num: string             // "1a.", "1.", etc.
  label: string
  value: number | undefined
  // For indented sub-rows (e.g. "Covered Securities" under 1099-B box 1d).
  subRows?: { label: string; value: number | undefined }[]
}

const SECTION_HEADER_H = 18
const SECTION_ROW_H = 11
const SECTION_LABEL_SIZE = 6.5
const SECTION_VALUE_SIZE = 7
const SECTION_NUM_COL_W = 22
const SECTION_VALUE_COL_W = 62

// Returns the y-coordinate just below the rendered section.
const drawSection = (
  ctx: DrawCtx,
  x: number,
  topY: number,
  w: number,
  taxYear: number,
  formName: string,        // "1099-DIV"
  sectionTitle: string,    // "DIVIDENDS AND DISTRIBUTIONS"
  ombNumber: string,       // "1545-0110"
  rows: BoxRow[],
): number => {
  const totalRowsH = rows.reduce(
    (acc, r) => acc + SECTION_ROW_H + (r.subRows?.length ?? 0) * SECTION_ROW_H,
    0,
  )
  const totalH = SECTION_HEADER_H + totalRowsH

  // Outer border
  rect(ctx, x, topY, w, totalH)

  // Section header (light shaded band — kept subtle, matches broker layout)
  rect(ctx, x, topY, w, SECTION_HEADER_H, { fill: HEADER_SHADE, stroke: false })
  // Heavier line under the header so it visually separates from rows
  hLine(ctx, x, x + w, topY + SECTION_HEADER_H, 0.8)
  text(ctx, x + 4, topY + 3, `IRS ${taxYear} FORM ${formName} - ${sectionTitle.toUpperCase()}`, {
    size: 7, bold: true,
  })
  text(ctx, x + 4, topY + 11, `BOX  OMB NO. ${ombNumber}`, { size: 6, bold: true })

  // Rows
  let y = topY + SECTION_HEADER_H
  const labelX = x + SECTION_NUM_COL_W
  const labelMaxW = w - SECTION_NUM_COL_W - SECTION_VALUE_COL_W
  const valueX = x + w - SECTION_VALUE_COL_W
  const valueMaxW = SECTION_VALUE_COL_W - 4

  rows.forEach((row, i) => {
    if (i > 0) hLine(ctx, x, x + w, y, 0.25)
    text(ctx, x + 4, y + 3, row.num, { size: SECTION_LABEL_SIZE, bold: true })
    text(ctx, labelX, y + 3, row.label, { size: SECTION_LABEL_SIZE, maxWidth: labelMaxW })
    text(ctx, valueX, y + 3, fmtMoney(row.value), {
      size: SECTION_VALUE_SIZE, align: "right", maxWidth: valueMaxW,
    })
    y += SECTION_ROW_H

    for (const sub of row.subRows ?? []) {
      hLine(ctx, x, x + w, y, 0.15)
      text(ctx, labelX + 14, y + 3, sub.label, { size: SECTION_LABEL_SIZE, maxWidth: labelMaxW - 14 })
      text(ctx, valueX, y + 3, fmtMoney(sub.value), {
        size: SECTION_VALUE_SIZE, align: "right", maxWidth: valueMaxW,
      })
      y += SECTION_ROW_H
    }
  })

  return topY + totalH
}

// ─── Per-section row builders ───────────────────────────────────────────

const divRows = (div: Form1099DivBoxes | undefined): BoxRow[] => [
  { num: "1a.", label: "TOTAL ORDINARY DIVIDENDS", value: div?.box1a },
  { num: "1b.", label: "QUALIFIED DIVIDENDS", value: div?.box1b },
  { num: "2a.", label: "TOTAL CAPITAL GAIN DISTRIBUTIONS", value: div?.box2a },
  { num: "2b.", label: "UNRECAP. SEC. 1250 GAIN", value: div?.box2b },
  { num: "2d.", label: "COLLECTIBLES (28%) GAIN", value: div?.box2d },
  { num: "2e.", label: "SECTION 897 ORDINARY DIVIDENDS", value: div?.box2e },
  { num: "2f.", label: "SECTION 897 CAPITAL GAIN", value: div?.box2f },
  { num: "3.",  label: "NON-DIVIDEND DISTRIBUTIONS", value: div?.box3 },
  { num: "4.",  label: "FEDERAL INCOME TAX WITHHELD", value: div?.box4 },
  { num: "5.",  label: "SECTION 199A DIVIDENDS", value: div?.box5 },
  { num: "6.",  label: "INVESTMENT EXPENSES", value: div?.box6 },
  { num: "7.",  label: "FOREIGN TAX PAID", value: div?.box7 },
  { num: "9.",  label: "CASH LIQUIDATION DISTRIBUTIONS", value: div?.box9 },
  { num: "10.", label: "NON-CASH LIQUIDATION DISTRIBUTIONS", value: div?.box10 },
  { num: "12.", label: "EXEMPT-INTEREST DIVIDENDS", value: div?.box12 },
  { num: "13.", label: "SPECIFIED PRIVATE ACTIVITY BOND INT. DIVS.", value: div?.box13 },
]

const intRows = (int: Form1099IntBoxes | undefined): BoxRow[] => [
  { num: "1.",  label: "INTEREST INCOME", value: int?.box1 },
  { num: "2.",  label: "EARLY WITHDRAWAL PENALTY", value: int?.box2 },
  { num: "3.",  label: "INTEREST ON U.S. SAVINGS BONDS / TREAS.", value: int?.box3 },
  { num: "4.",  label: "FEDERAL INCOME TAX WITHHELD", value: int?.box4 },
  { num: "5.",  label: "INVESTMENT EXPENSES", value: int?.box5 },
  { num: "6.",  label: "FOREIGN TAX PAID", value: int?.box6 },
  { num: "8.",  label: "TAX-EXEMPT INTEREST", value: int?.box8 },
  { num: "9.",  label: "SPECIFIED PRIVATE ACTIVITY BOND INTEREST", value: int?.box9 },
  { num: "10.", label: "MARKET DISCOUNT", value: int?.box10 },
  { num: "11.", label: "BOND PREMIUM", value: int?.box11 },
  { num: "12.", label: "BOND PREMIUM ON TREASURY OBLIGATIONS", value: int?.box12 },
  { num: "13.", label: "BOND PREMIUM ON TAX-EXEMPT BOND", value: int?.box13 },
]

const miscRows = (misc: Form1099MiscBoxes | undefined): BoxRow[] => [
  { num: "1.", label: "RENTS", value: misc?.box1 },
  { num: "2.", label: "ROYALTIES", value: misc?.box2 },
  { num: "3.", label: "OTHER INCOME", value: misc?.box3 },
  { num: "4.", label: "FEDERAL INCOME TAX WITHHELD", value: misc?.box4 },
  { num: "8.", label: "SUBSTITUTE PAYMENTS IN LIEU OF DIVS / INT", value: misc?.box8 },
]

const oidRows = (oid: Form1099OidBoxes | undefined): BoxRow[] => [
  { num: "1.",  label: "ORIGINAL ISSUE DISCOUNT FOR 2025", value: oid?.box1 },
  { num: "2.",  label: "OTHER PERIODIC INTEREST", value: oid?.box2 },
  { num: "4.",  label: "FEDERAL INCOME TAX WITHHELD", value: oid?.box4 },
  { num: "5.",  label: "MARKET DISCOUNT", value: oid?.box5 },
  { num: "6.",  label: "ACQUISITION PREMIUM", value: oid?.box6 },
  { num: "8.",  label: "OID ON U.S. TREASURY OBLIGATIONS", value: oid?.box8 },
  { num: "9.",  label: "INVESTMENT EXPENSES", value: oid?.box9 },
  { num: "10.", label: "BOND PREMIUM", value: oid?.box10 },
  { num: "11.", label: "TAX-EXEMPT OID", value: oid?.box11 },
]

const bRows = (b: Form1099BBoxes | undefined): BoxRow[] => [
  {
    num: "1d.",
    label: "PROCEEDS",
    value: b?.proceeds,
    subRows: [
      { label: "COVERED SECURITIES", value: b?.proceedsCovered },
      { label: "NONCOVERED SECURITIES", value: b?.proceedsNoncovered },
    ],
  },
  { num: "1e.", label: "COST OR OTHER BASIS OF COVERED SECURITIES", value: b?.costBasisCovered },
  { num: "1f.", label: "ACCRUED MARKET DISCOUNT", value: b?.accruedMarketDiscount },
  { num: "1g.", label: "WASH SALE LOSS DISALLOWED", value: b?.washSaleLossDisallowed },
  { num: "4.",  label: "FEDERAL INCOME TAX WITHHELD", value: b?.federalIncomeTaxWithheld },
]

// ─── Page header (used on both pages) ───────────────────────────────────

const drawPageHeader = (
  ctx: DrawCtx,
  taxpayer: Taxpayer,
  doc: Form1099ConsolidatedDocument,
  taxYear: number,
  pageLabel: string,
): number => {  // returns y just below the header
  // The right-side payer block is fixed width and pinned to the right.
  // The title strip is centered within the *remaining* horizontal space so
  // it doesn't crash into the payer info.
  const PAYER_BLOCK_W = 200
  const rightX = PAGE_W - MARGIN - PAYER_BLOCK_W
  const titleX = MARGIN
  const titleW = rightX - MARGIN - 8  // 8pt gap before payer block

  text(ctx, titleX, MARGIN + 2, "1099 Consolidated Tax Statement", {
    size: 12, bold: true, align: "center", maxWidth: titleW,
  })
  text(ctx, titleX, MARGIN + 18, `Tax Year ${taxYear}     Copy B For Recipient`, {
    size: 10, align: "center", maxWidth: titleW,
  })

  // Right-side payer block
  let rY = MARGIN
  text(ctx, rightX, rY, doc.payer.name, { size: 8, bold: true })
  rY += 10
  for (const line of fmtAddress(doc.payer.address)) {
    text(ctx, rightX, rY, line, { size: 8 })
    rY += 9
  }
  rY += 3
  text(ctx, rightX, rY, `Identification Number: ${doc.payer.tin}`, { size: 7 })
  rY += 9
  text(ctx, rightX, rY, `Taxpayer ID Number: ${maskSsn(taxpayer.ssn)}`, { size: 7 })
  rY += 9
  text(ctx, rightX, rY, `Account Number: ${doc.accountNumber}`, { size: 7 })
  rY += 9
  text(ctx, rightX, rY, pageLabel, { size: 8, bold: true })
  if (doc.payer.phone) {
    rY += 12
    text(ctx, rightX, rY, `Customer Service: ${doc.payer.phone}`, { size: 8, bold: true })
  }

  // Left-side recipient block (below the title)
  let lY = MARGIN + 36
  text(ctx, MARGIN, lY, "Name Reported to the IRS:", { size: 7, bold: true })
  lY += 10
  text(ctx, MARGIN, lY, `${taxpayer.name.first} ${taxpayer.name.last}`, { size: 9, bold: true })
  lY += 10
  for (const line of fmtAddress(taxpayer.address)) {
    text(ctx, MARGIN, lY, line, { size: 9 })
    lY += 10
  }

  // Header bottom: max of the two column bottoms + small gap
  return Math.max(rY, lY) + 8
}

// ─── Page 1: summary ────────────────────────────────────────────────────

const drawSummaryPage = (
  ctx: DrawCtx,
  doc: Form1099ConsolidatedDocument,
  taxpayer: Taxpayer,
  taxYear: number,
  pageLabel: string,
): void => {
  const headerBottom = drawPageHeader(ctx, taxpayer, doc, taxYear, pageLabel)

  // Notice paragraph (wraps to as many lines as needed)
  const noticeText =
    "This is important tax information and is being furnished to the Internal Revenue Service. " +
    "If you are required to file a return, a negligence penalty or other sanction may be imposed " +
    "on you if this income is taxable and the IRS determines that it has not been reported."
  const noticeBottom = drawParagraph(ctx, MARGIN, headerBottom, noticeText, {
    size: 7.5,
    maxWidth: PAGE_W - 2 * MARGIN,
    lineHeight: 9,
  })
  const bodyTop = noticeBottom + 6

  // Column geometry
  const colGap = 8
  const colW = (PAGE_W - 2 * MARGIN - colGap) / 2  // ≈ 266
  const leftX = MARGIN
  const rightX = MARGIN + colW + colGap

  // Left column: DIV → INT
  let lY = bodyTop
  if (doc.div !== undefined) {
    lY = drawSection(ctx, leftX, lY, colW, taxYear,
      "1099-DIV", "Dividends and Distributions", "1545-0110", divRows(doc.div))
    lY += 6
  }
  if (doc.int !== undefined) {
    lY = drawSection(ctx, leftX, lY, colW, taxYear,
      "1099-INT", "Interest Income", "1545-0112", intRows(doc.int))
  }

  // Right column: MISC → OID → B
  let rY = bodyTop
  if (doc.misc !== undefined) {
    rY = drawSection(ctx, rightX, rY, colW, taxYear,
      "1099-MISC", "Miscellaneous Information", "1545-0115", miscRows(doc.misc))
    rY += 6
  }
  if (doc.oid !== undefined) {
    rY = drawSection(ctx, rightX, rY, colW, taxYear,
      "1099-OID", "Original Issue Discount", "1545-0117", oidRows(doc.oid))
    rY += 6
  }
  if (doc.b !== undefined) {
    rY = drawSection(ctx, rightX, rY, colW, taxYear,
      "1099-B", "Proceeds From Broker and Barter Exchange", "1545-0715", bRows(doc.b))
  }

  // Footer
  text(ctx, MARGIN, PAGE_H - MARGIN - 10, "IMPORTANT TAX INFORMATION -- PLEASE RETAIN FOR YOUR RECORDS", {
    size: 8, bold: true, align: "center", maxWidth: PAGE_W - 2 * MARGIN,
  })
}

// ─── Page 2: 1099-DIV detail ────────────────────────────────────────────

type DivDetailColumn = {
  label: string
  width: number
  align: "left" | "right"
}

// Column labels use \n to force a line break. Real broker statements stack
// long headers across two lines so they fit narrow columns; we mirror that.
const DIV_DETAIL_COLS: DivDetailColumn[] = [
  { label: "DESCRIPTION",                  width: 130, align: "left"  },
  { label: "CUSIP",                        width: 60,  align: "left"  },
  { label: "PAY\nDATE",                    width: 50,  align: "left"  },
  { label: "ORDINARY\nDIVIDENDS",          width: 80,  align: "right" },
  { label: "QUALIFIED\nDIVIDENDS",         width: 80,  align: "right" },
  { label: "FEDERAL INCOME\nTAX WITHHELD", width: 70,  align: "right" },
  { label: "SECTION 199A\nDIVIDENDS",      width: 70,  align: "right" },
]
// Col widths sum to 540, matching formW.

const HEADER_LINE_H = 8

const drawDivDetailPage = (
  ctx: DrawCtx,
  doc: Form1099ConsolidatedDocument,
  taxpayer: Taxpayer,
  taxYear: number,
  pageLabel: string,
): void => {
  const headerBottom = drawPageHeader(ctx, taxpayer, doc, taxYear, pageLabel)
  let y = headerBottom + 12

  // Section title
  text(ctx, MARGIN, y, "1099-DIV   DIVIDENDS & DISTRIBUTIONS", { size: 11, bold: true })
  y += 14
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y, 0.5)
  y += 4
  text(ctx, MARGIN, y, "Ordinary Dividends", { size: 9, bold: true })
  y += 14

  // Column header row — each header may span multiple lines (split on \n).
  const formW = PAGE_W - 2 * MARGIN
  const headerLineCount = Math.max(...DIV_DETAIL_COLS.map((c) => c.label.split("\n").length))
  let cx = MARGIN
  for (const col of DIV_DETAIL_COLS) {
    const lines = col.label.split("\n")
    lines.forEach((line, i) => {
      text(ctx, cx, y + i * HEADER_LINE_H, line, {
        size: 6.5, bold: true,
        align: col.align,
        maxWidth: col.width - (col.align === "right" ? 4 : 0),
      })
    })
    cx += col.width
  }
  y += headerLineCount * HEADER_LINE_H + 2
  hLine(ctx, MARGIN, MARGIN + formW, y, 0.5)
  y += 4

  // Data rows
  const lines = doc.divDetail ?? []
  for (const line of lines) {
    drawDivDetailRow(ctx, y, line)
    y += 11
    hLine(ctx, MARGIN, MARGIN + formW, y - 1, 0.15)
  }

  // Subtotals
  y += 6
  const div = doc.div
  drawSubtotalRow(ctx, y, "Total Ordinary Dividends  1099-DIV box 1a", div?.box1a, "ordinary")
  y += 14
  drawSubtotalRow(ctx, y, "Total Qualified Dividends  1099-DIV box 1b", div?.box1b, "qualified")
  y += 14
  if ((div?.box4 ?? 0) > 0) {
    drawSubtotalRow(ctx, y, "Total Federal Income Tax Withheld  1099-DIV box 4", div?.box4, "fedWh")
    y += 14
  }
  if ((div?.box5 ?? 0) > 0) {
    drawSubtotalRow(ctx, y, "Total Section 199A Dividends  1099-DIV box 5", div?.box5, "sec199A")
    y += 14
  }
}

const drawDivDetailRow = (ctx: DrawCtx, topY: number, line: DividendDetailLine): void => {
  let cx = MARGIN
  const cells: Array<[string, "left" | "right"]> = [
    [line.description, "left"],
    [line.cusip ?? "", "left"],
    [line.payDate, "left"],
    [fmtMoney(line.ordinaryDividends), "right"],
    [fmtMoney(line.qualifiedDividends), "right"],
    [fmtMoney(line.federalIncomeTaxWithheld), "right"],
    [fmtMoney(line.section199ADividends), "right"],
  ]
  cells.forEach(([str, align], i) => {
    const col = DIV_DETAIL_COLS[i]
    text(ctx, cx, topY, str, {
      size: 7.5, align, maxWidth: col.width - (align === "right" ? 4 : 0),
    })
    cx += col.width
  })
}

// Column-aligned subtotal: label spans description+cusip+paydate, value lands
// in the matching column.
const drawSubtotalRow = (
  ctx: DrawCtx,
  topY: number,
  label: string,
  value: number | undefined,
  column: "ordinary" | "qualified" | "fedWh" | "sec199A",
): void => {
  text(ctx, MARGIN, topY, label, { size: 8, bold: true })

  // Find the right column index for the value
  const colIndex = column === "ordinary" ? 3
    : column === "qualified" ? 4
    : column === "fedWh" ? 5
    : 6
  let cx = MARGIN
  for (let i = 0; i < colIndex; i++) cx += DIV_DETAIL_COLS[i].width
  const col = DIV_DETAIL_COLS[colIndex]
  text(ctx, cx, topY, fmtMoney(value), {
    size: 8, bold: true, align: "right", maxWidth: col.width - 4,
  })
}

// ─── Page 3: 1099-B trade detail ─────────────────────────────────────────

const fmtSignedMoney = (n: number | undefined): string => {
  const v = n ?? 0
  const abs = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return v < 0 ? `($${abs})` : `$${abs}`
}

type TradeTotals = {
  quantity: number
  proceeds: number
  costBasis: number
  accruedMarketDiscount: number
  washSaleLossDisallowed: number
  gainLoss: number
  federalIncomeTaxWithheld: number
}

const zeroTotals = (): TradeTotals => ({
  quantity: 0, proceeds: 0, costBasis: 0, accruedMarketDiscount: 0,
  washSaleLossDisallowed: 0, gainLoss: 0, federalIncomeTaxWithheld: 0,
})

const addTradeToTotals = (acc: TradeTotals, t: TradeDetailLine): void => {
  acc.quantity += t.quantity
  acc.proceeds += t.proceeds
  acc.costBasis += t.costBasis ?? 0
  acc.accruedMarketDiscount += t.accruedMarketDiscount ?? 0
  acc.washSaleLossDisallowed += t.washSaleLossDisallowed ?? 0
  acc.gainLoss += t.gainLoss
  acc.federalIncomeTaxWithheld += t.federalIncomeTaxWithheld ?? 0
}

const mergeTotals = (dest: TradeTotals, src: TradeTotals): void => {
  dest.quantity += src.quantity
  dest.proceeds += src.proceeds
  dest.costBasis += src.costBasis
  dest.accruedMarketDiscount += src.accruedMarketDiscount
  dest.washSaleLossDisallowed += src.washSaleLossDisallowed
  dest.gainLoss += src.gainLoss
  dest.federalIncomeTaxWithheld += src.federalIncomeTaxWithheld
}

// Form 8949 reporting reference under each group subtitle. Mirrors what
// real broker statements print verbatim.
const form8949Reference = (section: TradeSection): string => {
  switch (section) {
    case "long-covered":
      return "(Consider Box 12 (Basis Reported to IRS) as being checked for this section. These transactions should be reported on Form 8949 Part II with box D checked.)"
    case "long-noncovered":
      return "(Consider Box 5 (Noncovered Security) as being checked and Box 12 (Basis Reported to IRS) as not being checked for this section. These transactions should be reported on Form 8949 Part II with box E checked.)"
    case "short-covered":
      return "(Consider Box 12 (Basis Reported to IRS) as being checked for this section. These transactions should be reported on Form 8949 Part I with box A checked.)"
    case "short-noncovered":
      return "(Consider Box 5 (Noncovered Security) as being checked and Box 12 (Basis Reported to IRS) as not being checked for this section. These transactions should be reported on Form 8949 Part I with box B checked.)"
  }
}

const fmtQuantity = (q: number): string =>
  q.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })

type SecurityGroup = {
  description: string
  cusip?: string
  symbol?: string
  trades: TradeDetailLine[]
}

const groupBySecurity = (trades: TradeDetailLine[]): SecurityGroup[] => {
  const map = new Map<string, SecurityGroup>()
  for (const t of trades) {
    const key = `${t.description}|${t.cusip ?? ""}`
    const existing = map.get(key)
    if (existing) existing.trades.push(t)
    else map.set(key, { description: t.description, cusip: t.cusip, symbol: t.symbol, trades: [t] })
  }
  return Array.from(map.values())
}

type TradeColumn = { label: string; width: number; align: "left" | "right" }

// 10 columns; widths sum to 540. Long header labels use \n to wrap onto
// multiple lines, mirroring how brokers print these tables.
const TRADE_DETAIL_COLS: TradeColumn[] = [
  { label: "DESCRIPTION\n(Box 1a)",                  width: 90, align: "left"  },
  { label: "QUANTITY",                                width: 35, align: "right" },
  { label: "DATE\nACQUIRED\n(Box 1b)",               width: 45, align: "left"  },
  { label: "DATE\nSOLD\n(Box 1c)",                   width: 45, align: "left"  },
  { label: "PROCEEDS\n(Box 1d)",                     width: 55, align: "right" },
  { label: "COST OR OTHER\nBASIS\n(Box 1e)",         width: 55, align: "right" },
  { label: "ACCRUED\nMARKET\nDISCOUNT\n(Box 1f)",    width: 50, align: "right" },
  { label: "WASH SALE\nLOSS\nDISALLOWED\n(Box 1g)",  width: 50, align: "right" },
  { label: "GAIN/(LOSS)\nAMOUNT",                    width: 55, align: "right" },
  { label: "FEDERAL\nINCOME TAX\nWITHHELD\n(Box 4)", width: 60, align: "right" },
]

// Canonical print order: short before long, covered before noncovered.
const TRADE_GROUPS: { section: TradeSection; title: string }[] = [
  { section: "short-covered",    title: "Short Term - Covered Securities"    },
  { section: "short-noncovered", title: "Short Term - Noncovered Securities" },
  { section: "long-covered",     title: "Long Term - Covered Securities"     },
  { section: "long-noncovered",  title: "Long Term - Noncovered Securities"  },
]

const drawTradeRow = (ctx: DrawCtx, topY: number, t: TradeDetailLine): void => {
  // DESCRIPTION column (col 0) is left blank — the security header line
  // above the row carries the name + CUSIP + symbol.
  const cells: Array<[string, "left" | "right"]> = [
    ["", "left"],
    [t.quantity.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 }), "right"],
    [t.dateAcquired, "left"],
    [t.dateSold, "left"],
    [fmtMoney(t.proceeds), "right"],
    [fmtMoney(t.costBasis), "right"],
    [fmtMoney(t.accruedMarketDiscount), "right"],
    [fmtMoney(t.washSaleLossDisallowed), "right"],
    [fmtSignedMoney(t.gainLoss), "right"],
    [fmtMoney(t.federalIncomeTaxWithheld), "right"],
  ]
  let cx = MARGIN
  cells.forEach(([str, align], i) => {
    const col = TRADE_DETAIL_COLS[i]
    if (str) {
      text(ctx, cx, topY, str, {
        size: 7, align, maxWidth: col.width - (align === "right" ? 4 : 0),
      })
    }
    cx += col.width
  })
}

// Subtotal/total line: label on the left (spans the first 4 columns), six
// totals right-aligned in their data columns. `bold` controls emphasis.
const drawTradeSubtotalLine = (
  ctx: DrawCtx,
  topY: number,
  label: string,
  totals: TradeTotals,
  opts: { bold?: boolean } = {},
): void => {
  const bold = opts.bold ?? false
  text(ctx, MARGIN, topY, label, { size: 7.5, bold })
  // Skip first 4 columns (description / quantity / dates); numbers start
  // at the PROCEEDS column.
  let cx = MARGIN
  for (let i = 0; i < 4; i++) cx += TRADE_DETAIL_COLS[i].width
  const numericCols: Array<{ value: number; signed?: boolean }> = [
    { value: totals.proceeds },
    { value: totals.costBasis },
    { value: totals.accruedMarketDiscount },
    { value: totals.washSaleLossDisallowed },
    { value: totals.gainLoss, signed: true },
    { value: totals.federalIncomeTaxWithheld },
  ]
  numericCols.forEach((nc, i) => {
    const col = TRADE_DETAIL_COLS[4 + i]
    const formatted = nc.signed ? fmtSignedMoney(nc.value) : fmtMoney(nc.value)
    text(ctx, cx, topY, formatted, {
      size: 7.5, bold, align: "right", maxWidth: col.width - 4,
    })
    cx += col.width
  })
}

// ─── Page: 1099-B Totals Summary (Realized Gain/Loss Summary) ───────────

type TotalsCol = { label: string; width: number }

// Numeric column structure on the totals summary page. Multi-line labels
// use \n; rendered right-aligned in their column.
const TOTALS_COLS: TotalsCol[] = [
  { label: "PROCEEDS",                   width: 60 },
  { label: "COST BASIS",                 width: 60 },
  { label: "MARKET\nDISCOUNT",           width: 65 },
  { label: "WASH SALE LOSS\nDISALLOWED", width: 80 },
  { label: "REALIZED GAIN\nOR (LOSS)",   width: 65 },
]
const TOTALS_LABEL_W = 540 - TOTALS_COLS.reduce((s, c) => s + c.width, 0)  // 210

const drawTotalsRow = (
  ctx: DrawCtx,
  topY: number,
  label: string,
  values: Array<number | undefined>,
  opts: { bold?: boolean; signedIdx?: number; indent?: number } = {},
): void => {
  const bold = opts.bold ?? false
  const indent = opts.indent ?? 0
  text(ctx, MARGIN + indent, topY, label, { size: 7.5, bold })
  let cx = MARGIN + TOTALS_LABEL_W
  values.forEach((v, i) => {
    const col = TOTALS_COLS[i]
    const formatted = i === opts.signedIdx ? fmtSignedMoney(v) : fmtMoney(v)
    text(ctx, cx, topY, formatted, {
      size: 7.5, bold, align: "right", maxWidth: col.width - 4,
    })
    cx += col.width
  })
}

const drawBTotalsPage = (
  ctx: DrawCtx,
  doc: Form1099ConsolidatedDocument,
  taxpayer: Taxpayer,
  taxYear: number,
  pageLabel: string,
): void => {
  const headerBottom = drawPageHeader(ctx, taxpayer, doc, taxYear, pageLabel)
  let y = headerBottom + 12

  // Title block
  text(ctx, MARGIN, y, "FORM 1099-B TOTALS SUMMARY", { size: 12, bold: true })
  y += 18
  text(ctx, MARGIN, y, "REALIZED GAIN/LOSS SUMMARY", { size: 10, bold: true })
  y += 12
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y, 0.5)
  y += 4
  drawParagraph(ctx, MARGIN, y,
    "Refer to Proceeds from Broker and Barter Exchange Transactions for detailed information regarding these summary values. The amounts shown below are for informational purposes only.",
    { size: 7, maxWidth: PAGE_W - 2 * MARGIN, lineHeight: 9 })
  y += 16

  // Compute per-section totals from bDetail
  const trades = doc.bDetail ?? []
  const sectionTotals = (sec: TradeSection): TradeTotals => {
    const t = zeroTotals()
    for (const tr of trades) if (tr.section === sec) addTradeToTotals(t, tr)
    return t
  }
  const shortCovered = sectionTotals("short-covered")
  const shortNoncovered = sectionTotals("short-noncovered")
  const longCovered = sectionTotals("long-covered")
  const longNoncovered = sectionTotals("long-noncovered")
  const totalShort = zeroTotals()
  mergeTotals(totalShort, shortCovered)
  mergeTotals(totalShort, shortNoncovered)
  const totalLong = zeroTotals()
  mergeTotals(totalLong, longCovered)
  mergeTotals(totalLong, longNoncovered)

  // Column header row (only drawn once at top of the gain/loss table)
  const headerLineCount = Math.max(...TOTALS_COLS.map((c) => c.label.split("\n").length))
  let cx = MARGIN + TOTALS_LABEL_W
  for (const col of TOTALS_COLS) {
    const lines = col.label.split("\n")
    lines.forEach((line, i) => {
      text(ctx, cx, y + i * HEADER_LINE_H, line, {
        size: 7, bold: true, align: "right", maxWidth: col.width - 4,
      })
    })
    cx += col.width
  }
  y += headerLineCount * HEADER_LINE_H + 2

  // Helper to draw one of the three "GAIN OR (LOSS)" sections
  const drawGainSection = (
    title: string,
    rows: Array<{ label: string; totals: TradeTotals; indent?: number }>,
    totalLabel: string,
    totalTotals: TradeTotals,
  ): void => {
    text(ctx, MARGIN, y, title, { size: 8, bold: true })
    y += 12
    hLine(ctx, MARGIN, PAGE_W - MARGIN, y - 2, 0.3)
    for (const r of rows) {
      drawTotalsRow(ctx, y, r.label, [
        r.totals.proceeds,
        r.totals.costBasis,
        r.totals.accruedMarketDiscount,
        r.totals.washSaleLossDisallowed,
        r.totals.gainLoss,
      ], { signedIdx: 4, indent: r.indent })
      y += 12
      hLine(ctx, MARGIN, PAGE_W - MARGIN, y - 2, 0.15)
    }
    drawTotalsRow(ctx, y, totalLabel, [
      totalTotals.proceeds,
      totalTotals.costBasis,
      totalTotals.accruedMarketDiscount,
      totalTotals.washSaleLossDisallowed,
      totalTotals.gainLoss,
    ], { bold: true, signedIdx: 4, indent: 100 })
    y += 16
  }

  drawGainSection(
    "SHORT-TERM GAIN OR (LOSSES) - REPORT ON FORM 8949, PART I",
    [
      { label: "Box A (basis reported to the IRS)", totals: shortCovered },
      { label: "Box A - Ordinary - (basis reported to the IRS)", totals: zeroTotals() },
      { label: "Box B (basis not reported to the IRS)", totals: shortNoncovered },
      { label: "Box B - Ordinary - (basis not reported to the IRS)", totals: zeroTotals() },
    ],
    "Total Short - Term",
    totalShort,
  )

  drawGainSection(
    "LONG-TERM GAIN OR (LOSSES) - REPORT ON FORM 8949, PART II",
    [
      { label: "Box D (basis reported to the IRS)", totals: longCovered },
      { label: "Box D - Ordinary - (basis reported to the IRS)", totals: zeroTotals() },
      { label: "Box E (basis not reported to the IRS)", totals: longNoncovered },
      { label: "Box E - Ordinary - (basis not reported to the IRS)", totals: zeroTotals() },
    ],
    "Total Long - Term",
    totalLong,
  )

  drawGainSection(
    "UNKNOWN TERM - CODE (X) REPORT ON FORM 8949, PART I OR PART II",
    [
      { label: "Box B or Box E (basis not reported to the IRS)", totals: zeroTotals() },
      { label: "Box B or Box E - Ordinary - (basis not reported to the IRS)", totals: zeroTotals() },
    ],
    "Total Unknown Term",
    zeroTotals(),
  )

  // ─── Regulated Futures Contracts (single AMOUNT column) ───
  y += 6
  text(ctx, MARGIN, y, "REGULATED FUTURES CONTRACTS", { size: 8, bold: true })
  text(ctx, MARGIN + TOTALS_LABEL_W, y, "AMOUNT", {
    size: 7, bold: true, align: "right", maxWidth: TOTALS_COLS[0].width - 4,
  })
  y += 12
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y - 2, 0.3)
  const rfcRows: Array<[string, number, boolean]> = [
    ["Profit or (loss) realized in 2025 - closed contracts", 0, false],
    [`Unrealized Profit or (loss) on open contracts 12/31/${taxYear - 1}`, 0, false],
    [`Unrealized Profit or (loss) on open contracts 12/31/${taxYear}`, 0, false],
    ["Aggregate profit or (loss) on contracts", 0, true],
  ]
  for (const [label, amount, bold] of rfcRows) {
    text(ctx, MARGIN, y, label, { size: 7.5, bold })
    text(ctx, MARGIN + TOTALS_LABEL_W, y, fmtSignedMoney(amount), {
      size: 7.5, bold, align: "right", maxWidth: TOTALS_COLS[0].width - 4,
    })
    y += 12
    hLine(ctx, MARGIN, PAGE_W - MARGIN, y - 2, 0.15)
  }
}

const drawTradeDetailPage = (
  ctx: DrawCtx,
  doc: Form1099ConsolidatedDocument,
  taxpayer: Taxpayer,
  taxYear: number,
  pageLabel: string,
): void => {
  const headerBottom = drawPageHeader(ctx, taxpayer, doc, taxYear, pageLabel)
  let y = headerBottom + 12

  text(ctx, MARGIN, y, "1099-B   PROCEEDS FROM BROKER AND BARTER EXCHANGE TRANSACTIONS", {
    size: 11, bold: true,
  })
  y += 14
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y, 0.5)
  y += 6

  const trades = doc.bDetail ?? []
  const formW = PAGE_W - 2 * MARGIN
  const grandTotals = zeroTotals()

  for (const group of TRADE_GROUPS) {
    const groupTrades = trades.filter((t) => t.section === group.section)
    if (groupTrades.length === 0) continue

    // Group subtitle
    text(ctx, MARGIN, y, group.title, { size: 9, bold: true })
    y += 13

    // Multi-line column header
    const headerLineCount = Math.max(...TRADE_DETAIL_COLS.map((c) => c.label.split("\n").length))
    let cx = MARGIN
    for (const col of TRADE_DETAIL_COLS) {
      const lines = col.label.split("\n")
      lines.forEach((line, i) => {
        text(ctx, cx, y + i * HEADER_LINE_H, line, {
          size: 6, bold: true, align: col.align,
          maxWidth: col.width - (col.align === "right" ? 4 : 0),
        })
      })
      cx += col.width
    }
    y += headerLineCount * HEADER_LINE_H + 2
    hLine(ctx, MARGIN, MARGIN + formW, y, 0.5)
    y += 4

    // Per-security: header line, trade rows, security subtotal
    const securities = groupBySecurity(groupTrades)
    const groupTotals = zeroTotals()

    for (const sec of securities) {
      const headerStr = `${sec.description}      CUSIP: ${sec.cusip ?? "—"}      Symbol: ${sec.symbol ?? "—"}`
      text(ctx, MARGIN, y, headerStr, { size: 7.5, bold: true })
      y += 11

      const secTotals = zeroTotals()
      for (const t of sec.trades) {
        drawTradeRow(ctx, y, t)
        addTradeToTotals(secTotals, t)
        y += 11
        hLine(ctx, MARGIN, MARGIN + formW, y - 1, 0.15)
      }

      drawTradeSubtotalLine(ctx, y, "Security Subtotal", secTotals)
      y += 12
      mergeTotals(groupTotals, secTotals)
    }

    // Group total
    y += 2
    drawTradeSubtotalLine(ctx, y, `Total ${group.title}`, groupTotals, { bold: true })
    y += 16
    mergeTotals(grandTotals, groupTotals)
  }

  // Grand total across all sections
  hLine(ctx, MARGIN, PAGE_W - MARGIN, y, 0.5)
  y += 4
  drawTradeSubtotalLine(ctx, y, "Total Covered and Noncovered Securities", grandTotals, { bold: true })
}

// ─── Cover page ──────────────────────────────────────────────────────────

type PageKind = "cover" | "summary" | "div-detail" | "b-totals" | "b-detail"

// Approximate "Date Issued" — real brokers issue the prior-year statement
// in mid-Feb of the following year. Synthesizing for the fixture.
const dateIssued = (taxYear: number): string => {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]
  return `${months[1]} 15, ${taxYear + 1}`
}

// Pad a TOC entry like "1099-DIV Dividends and Distributions...........2"
const tocLine = (label: string, page: number, totalWidth: number, font: PDFFont, size: number): string => {
  const pageStr = page.toString()
  const dotsAvailable = totalWidth
    - font.widthOfTextAtSize(label, size)
    - font.widthOfTextAtSize(pageStr, size)
    - 4
  if (dotsAvailable <= 0) return `${label} ${pageStr}`
  // 1 dot is ~2pt wide at 8pt; produce dots to fill space
  const dotW = font.widthOfTextAtSize(".", size)
  const dotCount = Math.max(3, Math.floor(dotsAvailable / dotW))
  return `${label}${".".repeat(dotCount)}${pageStr}`
}

const drawCoverPage = (
  ctx: DrawCtx,
  doc: Form1099ConsolidatedDocument,
  taxpayer: Taxpayer,
  taxYear: number,
  pages: PageKind[],
  pageLabel: string,
): void => {
  // Page numbers for sections — all populated form sections live on the
  // summary page, so they share a number; detail pages get their own.
  const summaryPage = pages.indexOf("summary") + 1
  const divDetailPage = pages.includes("div-detail") ? pages.indexOf("div-detail") + 1 : 0
  const bTotalsPage = pages.includes("b-totals") ? pages.indexOf("b-totals") + 1 : 0
  const bDetailPage = pages.includes("b-detail") ? pages.indexOf("b-detail") + 1 : 0

  // ─── Top strip: title (left/centered) + date issued + page label (right) ───
  const titleW = PAGE_W - 2 * MARGIN - 180
  text(ctx, MARGIN, MARGIN + 4, "1099 Consolidated Tax Statement", {
    size: 13, bold: true, align: "center", maxWidth: titleW,
  })
  text(ctx, MARGIN, MARGIN + 22, `Tax Year ${taxYear} - ORIGINAL`, {
    size: 11, bold: true, align: "center", maxWidth: titleW,
  })

  const topRightX = PAGE_W - MARGIN - 180
  text(ctx, topRightX, MARGIN + 2, "Date Issued", { size: 8, bold: true })
  text(ctx, topRightX, MARGIN + 12, dateIssued(taxYear), { size: 9 })
  text(ctx, topRightX, MARGIN + 28, pageLabel, { size: 9, bold: true, align: "right", maxWidth: 180 })

  // Body starts well below the top strip so it can't collide.
  const bodyTop = MARGIN + 56

  // ─── LEFT COLUMN: Account Mailing Address, then Legal Name (stacked) ───
  const leftX = MARGIN
  let lY = bodyTop
  text(ctx, leftX, lY, "Account Mailing Address", { size: 8, bold: true })
  lY += 12
  text(ctx, leftX, lY, "Account Owner", { size: 7, bold: true })
  lY += 10
  text(ctx, leftX, lY, `${taxpayer.name.first} ${taxpayer.name.last}`.toUpperCase(), { size: 8 })
  lY += 10
  for (const line of fmtAddress(taxpayer.address)) {
    text(ctx, leftX, lY, line.toUpperCase(), { size: 8 })
    lY += 10
  }
  lY += 14

  text(ctx, leftX, lY, "Legal Name and Address Reported", { size: 8, bold: true })
  lY += 10
  text(ctx, leftX, lY, "to IRS and State Taxing Authorities", { size: 8, bold: true })
  lY += 12
  text(ctx, leftX, lY, `${taxpayer.name.first} ${taxpayer.name.last}`.toUpperCase(), { size: 8 })
  lY += 10
  for (const line of fmtAddress(taxpayer.address)) {
    text(ctx, leftX, lY, line.toUpperCase(), { size: 8 })
    lY += 10
  }

  // ─── RIGHT COLUMN: Account Number, Customer Service, TOC ───
  const tocColW = 250
  const rightX = PAGE_W - MARGIN - tocColW
  let rY = bodyTop
  text(ctx, rightX, rY, "Account Number", { size: 8, bold: true })
  rY += 10
  text(ctx, rightX, rY, doc.accountNumber, { size: 9 })
  rY += 16
  if (doc.payer.phone) {
    text(ctx, rightX, rY, `Customer Service:  ${doc.payer.phone}`, { size: 9, bold: true })
    rY += 16
  }
  text(ctx, rightX, rY, "What's included in this packet:", { size: 9, bold: true })
  rY += 16

  text(ctx, rightX, rY, "Reportable to the IRS", { size: 8, bold: true })
  text(ctx, rightX, rY, "Page", { size: 8, bold: true, align: "right", maxWidth: tocColW })
  rY += 11

  const tocSize = 8
  const reportable: Array<[string, number]> = [
    ["1099-DIV Dividends and Distributions", summaryPage],
    ["1099-INT Interest Income", summaryPage],
    ["1099-MISC Miscellaneous Information", summaryPage],
    ["1099-OID Original Issue Discount", summaryPage],
    ["1099-B Proceeds from Transactions", summaryPage],
  ]
  if (divDetailPage > 0) reportable.push(["Details of 1099-DIV Dividends and Distributions", divDetailPage])
  if (bTotalsPage > 0) reportable.push(["1099-B Totals Summary", bTotalsPage])
  if (bDetailPage > 0) reportable.push(["Details of 1099-B Proceeds from Transactions", bDetailPage])

  for (const [label, p] of reportable) {
    text(ctx, rightX, rY, tocLine(label, p, tocColW, ctx.font, tocSize), { size: tocSize })
    rY += 10
  }

  rY += 14
  text(ctx, rightX, rY, "Non-Reportable to the IRS", { size: 8, bold: true })
  text(ctx, rightX, rY, "Page", { size: 8, bold: true, align: "right", maxWidth: tocColW })
  rY += 11
  text(ctx, rightX, rY, "(none)", { size: tocSize, maxWidth: tocColW })

  // ─── Intro paragraphs below both columns ───
  let pY = Math.max(lY, rY) + 28
  const intro =
    `This ${doc.payer.name} ${taxYear} Consolidated Tax Statement provides your official tax information ` +
    "for use when preparing your tax return. It is important to note that the income information that was reported on your December " +
    "account statement will not have included certain adjustments occurring after year-end but are reflected on your Form 1099 " +
    "and are necessary for tax reporting purposes."
  pY = drawParagraph(ctx, MARGIN, pY, intro, {
    size: 8, maxWidth: PAGE_W - 2 * MARGIN, lineHeight: 10,
  })
  pY += 10

  const note =
    "The following tax documents are not included in this statement and are sent individually in separate mailings, if required: " +
    "Forms 1099-R, 1099-Q, 1042-S, 2439, 5498, 5498-ESA, Schedule K-1."
  drawParagraph(ctx, MARGIN, pY, note, {
    size: 8, maxWidth: PAGE_W - 2 * MARGIN, lineHeight: 10,
  })

  // ─── Warning box at bottom ───
  const warnH = 50
  const warnY = PAGE_H - MARGIN - warnH - 24
  rect(ctx, MARGIN, warnY, PAGE_W - 2 * MARGIN, warnH, { fill: CALLOUT_SHADE })
  text(ctx, MARGIN + 8, warnY + 6, "*** WARNING - CORRECTED TAX FORMS POSSIBLE ***", {
    size: 9, bold: true,
  })
  drawParagraph(ctx, MARGIN + 8, warnY + 20,
    `The Forms 1099 included in your ${doc.payer.name} ${taxYear} Consolidated Tax Statement were prepared based upon information ` +
    "provided by the issuer of each security. The issuer may change the tax status of a distribution reported to you after the issuance " +
    "of this 1099 Consolidated Tax Statement. If that occurs, we may be required to send you one or more corrections.",
    { size: 7.5, maxWidth: PAGE_W - 2 * MARGIN - 16, lineHeight: 9 },
  )
}

// ─── Entry point ─────────────────────────────────────────────────────────

export async function renderForm1099Consolidated(
  doc: Form1099ConsolidatedDocument,
  taxpayer: Taxpayer,
  taxYear: number,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Page composition: cover always page 1; summary always page 2; detail
  // and totals pages are added when their data shapes are present in the
  // doc. The 1099-B totals summary precedes the per-trade detail to match
  // the broker-form ordering.
  const pages: PageKind[] = ["cover", "summary"]
  if (doc.divDetail && doc.divDetail.length > 0) pages.push("div-detail")
  if (doc.bDetail && doc.bDetail.length > 0) {
    pages.push("b-totals")
    pages.push("b-detail")
  }

  pages.forEach((kind, i) => {
    const page = pdf.addPage([PAGE_W, PAGE_H])
    const ctx: DrawCtx = { page, font, fontBold }
    const label = `Page ${i + 1} of ${pages.length}`
    switch (kind) {
      case "cover":
        drawCoverPage(ctx, doc, taxpayer, taxYear, pages, label)
        break
      case "summary":
        drawSummaryPage(ctx, doc, taxpayer, taxYear, label)
        break
      case "div-detail":
        drawDivDetailPage(ctx, doc, taxpayer, taxYear, label)
        break
      case "b-totals":
        drawBTotalsPage(ctx, doc, taxpayer, taxYear, label)
        break
      case "b-detail":
        drawTradeDetailPage(ctx, doc, taxpayer, taxYear, label)
        break
    }
  })

  return pdf.save()
}
