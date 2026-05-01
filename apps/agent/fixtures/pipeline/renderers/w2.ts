import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"
import type { Taxpayer, W2Document } from "../types.js"

// Layout reference: IRS Form W-2 Copy B (fw2.pdf from irs.gov).
// Top-origin coordinates in design code; converted to pdf-lib's bottom-origin
// at draw time. All measurements in PDF points (72 per inch).

const PAGE_W = 612   // US Letter
const PAGE_H = 792
const MARGIN = 36

const BLACK = rgb(0, 0, 0)
const SHADE = rgb(0.92, 0.94, 0.96)   // very pale blue shading IRS uses on alternate cells
const GRAY_FILL = rgb(0.75, 0.75, 0.75) // gray-filled box 9

const fmtMoney = (n: number | undefined): string =>
  n === undefined
    ? ""
    : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtAddress = (a: { line1: string; line2?: string; city: string; state: string; zip: string }): string[] =>
  [a.line1, a.line2, `${a.city}, ${a.state} ${a.zip}`].filter(Boolean) as string[]

type DrawCtx = {
  page: PDFPage
  font: PDFFont       // Helvetica
  fontBold: PDFFont   // Helvetica-Bold
}

const ty = (topY: number): number => PAGE_H - topY

const rect = (
  ctx: DrawCtx,
  x: number,
  topY: number,
  w: number,
  h: number,
  opts: { fill?: ReturnType<typeof rgb>; stroke?: boolean } = {},
): void => {
  ctx.page.drawRectangle({
    x,
    y: ty(topY + h),
    width: w,
    height: h,
    borderColor: opts.stroke === false ? undefined : BLACK,
    borderWidth: opts.stroke === false ? 0 : 0.5,
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
  const size = opts.size ?? 8
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

// Cell: a bordered box with a top-left label and right-aligned value.
const cell = (
  ctx: DrawCtx,
  x: number,
  topY: number,
  w: number,
  h: number,
  labelText: string,
  valueText: string,
  opts: { fill?: ReturnType<typeof rgb>; valueSize?: number; valueAlign?: "left" | "right" } = {},
): void => {
  rect(ctx, x, topY, w, h, { fill: opts.fill })
  // Label bold, 6pt, top-left
  text(ctx, x + 3, topY + 3, labelText, { size: 6, bold: true })
  // Value
  const vSize = opts.valueSize ?? 10
  const vAlign = opts.valueAlign ?? "right"
  const valueX = vAlign === "right" ? x + 4 : x + 4
  const valueW = w - 8
  text(ctx, valueX, topY + h - vSize - 2, valueText, {
    size: vSize,
    align: vAlign,
    maxWidth: valueW,
  })
}

// Cell that's just a bordered rectangle with a label — caller fills contents.
const cellShell = (
  ctx: DrawCtx,
  x: number,
  topY: number,
  w: number,
  h: number,
  labelText: string,
  opts: { fill?: ReturnType<typeof rgb> } = {},
): void => {
  rect(ctx, x, topY, w, h, { fill: opts.fill })
  text(ctx, x + 3, topY + 3, labelText, { size: 6, bold: true })
}

export async function renderW2(
  doc: W2Document,
  taxpayer: Taxpayer,
  taxYear: number,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([PAGE_W, PAGE_H])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ctx: DrawCtx = { page, font, fontBold }

  const formX = MARGIN
  const formW = PAGE_W - 2 * MARGIN   // 540
  const bodyX = formX
  const leftW = 310
  const rightX = formX + leftW        // 346
  const rightW = formW - leftW        // 230
  const rightHalfW = rightW / 2       // 115

  // ═══════════════ TOP STRIP (SSN + OMB) ═══════════════
  const topStripY = MARGIN
  const topStripH = 30

  // Left gap (~115pt wide). On Copy A this holds the 22222 + VOID; Copy B leaves it blank.
  // We render a thin gap then box a.
  const aX = formX + 115
  const aW = 195
  cellShell(ctx, aX, topStripY, aW, topStripH, "a  Employee's social security number", { fill: SHADE })
  text(ctx, aX + 4, topStripY + topStripH - 13, taxpayer.ssn, { size: 11 })

  // OMB + e-file info (right of box a)
  const ombX = aX + aW
  const ombW = formW - (ombX - formX)
  rect(ctx, ombX, topStripY, ombW, topStripH, { stroke: false })
  text(ctx, ombX + 4, topStripY + 2, "OMB No. 1545-0029", { size: 7, bold: true })
  text(ctx, ombX + 4, topStripY + 14, "Safe, accurate,", { size: 6 })
  text(ctx, ombX + 4, topStripY + 22, "FAST! Use", { size: 6 })
  text(ctx, ombX + 70, topStripY + 12, "IRS e-file", { size: 10, bold: true })
  text(ctx, ombX + 70, topStripY + 24, "www.irs.gov/efile", { size: 6 })

  // ═══════════════ MAIN BODY ═══════════════
  const bodyY = topStripY + topStripH       // 66
  const bodyH = 260
  const rowH = 29          // main numeric row height
  const smallRowH = 23     // smaller rows for 11/12a, 13/12b, 14/12c-d

  // ─── Left identity column ───
  // b — EIN
  cellShell(ctx, bodyX, bodyY, leftW, rowH, "b  Employer identification number (EIN)", { fill: SHADE })
  text(ctx, bodyX + 5, bodyY + rowH - 13, doc.employer.ein, { size: 11 })

  // c — Employer name, address, ZIP (spans 3 numeric rows: rows 2, 3, 4)
  const cY = bodyY + rowH
  const cH = rowH * 3
  cellShell(ctx, bodyX, cY, leftW, cH, "c  Employer's name, address, and ZIP code")
  const empLines = [doc.employer.name, ...fmtAddress(doc.employer.address)]
  empLines.forEach((line, i) => {
    text(ctx, bodyX + 5, cY + 14 + i * 12, line, { size: 9 })
  })

  // d — Control number (aligns with row 5 on right — 9/10 row)
  const dY = cY + cH
  cellShell(ctx, bodyX, dY, leftW, rowH, "d  Control number", { fill: SHADE })

  // e — Employee name (First | Last | Suff), aligns with rows 6 (11/12a) + 7 (13/12b) combined
  const eY = dY + rowH
  const eH = smallRowH * 2
  cellShell(ctx, bodyX, eY, leftW, eH, "e  Employee's first name and initial         Last name                    Suff.")
  // vertical dividers
  ctx.page.drawLine({ start: { x: bodyX + 180, y: ty(eY + eH) }, end: { x: bodyX + 180, y: ty(eY + 8) }, color: BLACK, thickness: 0.5 })
  ctx.page.drawLine({ start: { x: bodyX + 275, y: ty(eY + eH) }, end: { x: bodyX + 275, y: ty(eY + 8) }, color: BLACK, thickness: 0.5 })
  const fullFirst = [taxpayer.name.first, taxpayer.name.middle].filter(Boolean).join(" ")
  text(ctx, bodyX + 5, eY + 18, fullFirst, { size: 10 })
  text(ctx, bodyX + 185, eY + 18, taxpayer.name.last, { size: 10 })

  // f — Employee address (bottom of left column, spans remaining 4 small rows)
  const fY = eY + eH
  const fH = bodyY + bodyH - fY
  cellShell(ctx, bodyX, fY, leftW, fH, "f  Employee's address and ZIP code")
  fmtAddress(taxpayer.address).forEach((line, i) => {
    text(ctx, bodyX + 5, fY + 16 + i * 12, line, { size: 9 })
  })

  // ─── Right numeric column ───
  const numLabelPairs: Array<[string, string, number | undefined, string, string, number | undefined]> = [
    ["1",  "Wages, tips, other compensation", doc.boxes.box1,
     "2",  "Federal income tax withheld",     doc.boxes.box2],
    ["3",  "Social security wages",           doc.boxes.box3,
     "4",  "Social security tax withheld",    doc.boxes.box4],
    ["5",  "Medicare wages and tips",         doc.boxes.box5,
     "6",  "Medicare tax withheld",           doc.boxes.box6],
    ["7",  "Social security tips",            doc.boxes.box7,
     "8",  "Allocated tips",                  doc.boxes.box8],
  ]
  numLabelPairs.forEach(([leftN, leftLbl, leftV, rightN, rightLbl, rightV], i) => {
    const y = bodyY + i * rowH
    const fill = i % 2 === 0 ? SHADE : undefined
    cell(ctx, rightX, y, rightHalfW, rowH, `${leftN}  ${leftLbl}`, fmtMoney(leftV), { fill })
    cell(ctx, rightX + rightHalfW, y, rightHalfW, rowH, `${rightN}  ${rightLbl}`, fmtMoney(rightV), { fill })
  })

  // Row 5: box 9 (grayed) / box 10
  const row5Y = bodyY + 4 * rowH
  cellShell(ctx, rightX, row5Y, rightHalfW, rowH, "9", { fill: GRAY_FILL })
  cell(ctx, rightX + rightHalfW, row5Y, rightHalfW, rowH, "10  Dependent care benefits", fmtMoney(doc.boxes.box10), { fill: SHADE })

  // Row 6: 11 Nonqualified plans / 12a
  const row6Y = row5Y + rowH
  cell(ctx, rightX, row6Y, rightHalfW, smallRowH, "11  Nonqualified plans", fmtMoney(doc.boxes.box11), { fill: SHADE })
  const box12 = doc.boxes.box12 ?? []
  drawBox12(ctx, rightX + rightHalfW, row6Y, rightHalfW, smallRowH, "12a  See instructions for box 12", box12[0])

  // Row 7: 13 checkboxes / 12b
  const row7Y = row6Y + smallRowH
  drawBox13(ctx, rightX, row7Y, rightHalfW, smallRowH, doc.boxes.box13 ?? {})
  drawBox12(ctx, rightX + rightHalfW, row7Y, rightHalfW, smallRowH, "12b", box12[1])

  // Row 8: 14a (tall, spans 2 small rows) / 12c
  const row8Y = row7Y + smallRowH
  cellShell(ctx, rightX, row8Y, rightHalfW, smallRowH * 2, "14a  Other", { fill: SHADE })
  const box14 = doc.boxes.box14 ?? []
  box14.slice(0, 2).forEach((entry, i) => {
    text(ctx, rightX + 4, row8Y + 12 + i * 12, `${entry.label}  ${fmtMoney(entry.amount)}`, { size: 8 })
  })
  drawBox12(ctx, rightX + rightHalfW, row8Y, rightHalfW, smallRowH, "12c", box12[2])
  drawBox12(ctx, rightX + rightHalfW, row8Y + smallRowH, rightHalfW, smallRowH, "12d", box12[3])

  // Row 10: 14b (bottom)
  const row10Y = row8Y + smallRowH * 2
  cellShell(ctx, rightX, row10Y, rightW, smallRowH, "14b  Treasury Tipped Occupation Code(s)", { fill: SHADE })

  // ═══════════════ STATE / LOCAL STRIP ═══════════════
  const stateY = bodyY + bodyH
  const stateRowH = 28
  const stateCols: Array<{ n: string; label: string; w: number; val?: string }> = [
    { n: "15", label: "State", w: 45, val: doc.boxes.box15 },
    { n: "",  label: "Employer's state ID number", w: 95, val: "" },
    { n: "16", label: "State wages, tips, etc.", w: 90, val: fmtMoney(doc.boxes.box16) },
    { n: "17", label: "State income tax", w: 80, val: fmtMoney(doc.boxes.box17) },
    { n: "18", label: "Local wages, tips, etc.", w: 80, val: "" },
    { n: "19", label: "Local income tax", w: 75, val: "" },
    { n: "20", label: "Locality name", w: 75, val: "" },
  ]

  // Row 1 of state strip: column headers (with numbers)
  let sx = formX
  for (const c of stateCols) {
    const lbl = c.n ? `${c.n}  ${c.label}` : c.label
    cellShell(ctx, sx, stateY, c.w, stateRowH, lbl)
    if (c.val) {
      text(ctx, sx + 4, stateY + stateRowH - 12, c.val, {
        size: 10,
        align: "right",
        maxWidth: c.w - 8,
      })
    }
    sx += c.w
  }
  // Row 2 (blank second-state line)
  sx = formX
  for (const c of stateCols) {
    rect(ctx, sx, stateY + stateRowH, c.w, stateRowH)
    sx += c.w
  }

  // ═══════════════ FOOTER ═══════════════
  const footerY = stateY + stateRowH * 2 + 8
  // Left: Form W-2 (large), Wage and Tax Statement, year, Copy B
  text(ctx, formX, footerY, "Form", { size: 8 })
  text(ctx, formX + 25, footerY - 8, "W-2", { size: 22, bold: true })
  text(ctx, formX + 75, footerY + 4, "Wage and Tax Statement", { size: 11, bold: true })
  // Year
  text(ctx, formX + 225, footerY - 8, `${taxYear}`, { size: 22, bold: true })
  // Copy designation (below main title)
  text(ctx, formX, footerY + 22, "Copy B—To Be Filed With Employee's FEDERAL Tax Return.", { size: 9, bold: true })
  text(ctx, formX, footerY + 34, "This information is being furnished to the Internal Revenue Service.", { size: 8 })
  // IRS on right — right-align to form's right edge to avoid overflow
  text(ctx, formX, footerY - 4, "Department of the Treasury—Internal Revenue Service", {
    size: 8,
    align: "right",
    maxWidth: formW,
  })

  return pdf.save()
}

// ─── Helpers for box 12 and box 13 ───

function drawBox12(
  ctx: DrawCtx,
  x: number,
  topY: number,
  w: number,
  h: number,
  labelText: string,
  entry: { code: string; amount: number } | undefined,
): void {
  rect(ctx, x, topY, w, h, { fill: SHADE })
  text(ctx, x + 3, topY + 3, labelText, { size: 6, bold: true })

  // Vertical divider separating code column (narrow, left) from amount column (wide, right).
  // The IRS form includes a tiny stacked "Code" label in the narrow column; it's not
  // load-bearing for tests, so we skip it to avoid cramping this 23pt-tall cell.
  const codeColW = 20
  ctx.page.drawLine({
    start: { x: x + codeColW, y: ty(topY + h - 1) },
    end:   { x: x + codeColW, y: ty(topY + 11) },
    color: BLACK,
    thickness: 0.4,
  })

  if (entry) {
    // Both code and amount on the same baseline near the bottom of the cell.
    const dataY = topY + h - 13
    text(ctx, x + 6, dataY, entry.code, { size: 10, bold: true })
    text(ctx, x + codeColW + 3, dataY, fmtMoney(entry.amount), {
      size: 10,
      align: "right",
      maxWidth: w - codeColW - 6,
    })
  }
}

function drawBox13(
  ctx: DrawCtx,
  x: number,
  topY: number,
  w: number,
  h: number,
  b13: { statutoryEmployee?: boolean; retirementPlan?: boolean; thirdPartySickPay?: boolean },
): void {
  rect(ctx, x, topY, w, h, { fill: SHADE })
  text(ctx, x + 3, topY + 3, "13", { size: 6, bold: true })

  // Three small checkbox groups, horizontally arranged
  const groups: Array<[string, string, boolean]> = [
    ["Statutory", "employee", !!b13.statutoryEmployee],
    ["Retirement", "plan", !!b13.retirementPlan],
    ["Third-party", "sick pay", !!b13.thirdPartySickPay],
  ]
  const groupW = (w - 14) / 3
  groups.forEach(([l1, l2, checked], i) => {
    const gx = x + 14 + i * groupW
    text(ctx, gx, topY + 3, l1, { size: 5 })
    text(ctx, gx, topY + 9, l2, { size: 5 })
    // Checkbox at y = topY + 15
    const cbSize = 7
    const cbX = gx + 2
    const cbY = topY + 14
    rect(ctx, cbX, cbY, cbSize, cbSize)
    if (checked) {
      // Draw an X
      ctx.page.drawLine({
        start: { x: cbX + 1, y: ty(cbY + 1) },
        end:   { x: cbX + cbSize - 1, y: ty(cbY + cbSize - 1) },
        color: BLACK,
        thickness: 0.7,
      })
      ctx.page.drawLine({
        start: { x: cbX + cbSize - 1, y: ty(cbY + 1) },
        end:   { x: cbX + 1, y: ty(cbY + cbSize - 1) },
        color: BLACK,
        thickness: 0.7,
      })
    }
  })
}
