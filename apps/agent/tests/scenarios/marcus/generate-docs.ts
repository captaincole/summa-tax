// Render Marcus Chen's source intake documents to disk for the CPA package.
//
//   npx tsx tests/scenarios/marcus/generate-docs.ts
//
// Emits:
//   docs/01-marcus-w2.pdf               — Helix Software, Inc. W-2 (Copy B)
//   docs/02-marcus-1099-wealthfront.pdf — Wealthfront-style consolidated 1099
//                                         (only 1099-INT populated; everything
//                                         else $0 to mirror a HYSA-only account)
//   docs/03-marcus-1099-schwab.pdf      — Schwab-style consolidated 1099
//                                         (1099-DIV + 1099-B; mirrors the
//                                         Apex/Alejandro layout)
//
// One-off generator. The CPA receives these PDFs as Marcus's "source
// documents" alongside the Markdown brief + cover note in the same folder.

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFPage,
  type PDFFont,
} from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ────────────────────────────────────────────────────────────────────────────
// Constants — Marcus's identity & all the doc-level data
// ────────────────────────────────────────────────────────────────────────────

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;

const MARCUS = {
  name: "Marcus Chen",
  firstName: "Marcus",
  lastName: "Chen",
  ssn: "345-67-8901",
  ssnMasked: "XXX-XX-8901",
  street: "555 Hayes Street",
  cityStateZip: "San Francisco, CA 94102",
};

const HELIX = {
  name: "Helix Software, Inc.",
  ein: "87-1234567",
  street: "1455 Mission Street",
  cityStateZip: "San Francisco, CA 94103",
  stateId: "123-4567-8",
};

// W-2 numbers. Marcus's gross comp is $247,650 ($220k box-1 wages + $23.5k
// 401(k) + $4,150 HSA). SS wage base 2025 = $176,100 (capped); Additional
// Medicare 0.9% applies above $200k.
const W2 = {
  box1: 220_000.0,
  box2: 40_000.0,
  box3: 176_100.0,
  box4: 10_918.2,
  box5: 243_500.0,
  box6: 3_922.25,
  box12d: 23_500.0,
  box12w: 4_150.0,
  box14: "CA SDI 2,922.00",
  box16: 220_000.0,
  box17: 15_500.0,
};

const WEALTHFRONT = {
  payerName: "Wealthfront Brokerage LLC",
  payerStreet: "261 Hamilton Ave",
  payerCityStateZip: "Palo Alto, CA 94301",
  payerPhone: "844-995-8437",
  payerTIN: "27-1967207",
  account: "M7C81A92V",
  statementDate: "01/27/2026",
  documentId: "M9F4 R28 75NX 2025",
  interestTotal: 700.0,
  monthlyInterest: [
    { date: "01/01/25", amount: 52.43 },
    { date: "02/01/25", amount: 54.17 },
    { date: "03/01/25", amount: 56.02 },
    { date: "04/01/25", amount: 55.78 },
    { date: "05/01/25", amount: 57.45 },
    { date: "06/01/25", amount: 58.92 },
    { date: "07/01/25", amount: 59.84 },
    { date: "08/01/25", amount: 61.07 },
    { date: "09/01/25", amount: 62.13 },
    { date: "10/01/25", amount: 61.45 },
    { date: "11/01/25", amount: 60.32 },
    { date: "12/01/25", amount: 60.42 },
  ],
};

const SCHWAB = {
  payerName: "Charles Schwab & Co., Inc.",
  payerStreet: "211 Main Street",
  payerCityStateZip: "San Francisco, CA 94105",
  payerPhone: "800-435-4000",
  payerTIN: "94-1737782",
  account: "8842-3457",
  statementDate: "February 15, 2026",
  div: {
    box1aOrdinary: 3_000.0,
    box1bQualified: 2_000.0,
    detail: [
      { description: "VANGUARD TOTAL STOCK MARKET ETF", cusip: "922908769", payDate: "03/31/25", ord: 730.0, qual: 475.0 },
      { description: "VANGUARD TOTAL STOCK MARKET ETF", cusip: "922908769", payDate: "06/30/25", ord: 740.0, qual: 500.0 },
      { description: "VANGUARD TOTAL STOCK MARKET ETF", cusip: "922908769", payDate: "09/30/25", ord: 750.0, qual: 510.0 },
      { description: "VANGUARD TOTAL STOCK MARKET ETF", cusip: "922908769", payDate: "12/22/25", ord: 780.0, qual: 515.0 },
    ],
  },
  trades: {
    shortTerm: [
      { description: "TESLA INC", cusip: "88160R101", symbol: "TSLA", qty: 25, acquired: "02/14/25", sold: "11/05/25", proceeds: 14_000.0, basis: 10_000.0, gainLoss: 4_000.0 },
      { description: "JPMORGAN CHASE & CO", cusip: "46625H100", symbol: "JPM", qty: 50, acquired: "03/10/25", sold: "08/22/25", proceeds: 8_500.0, basis: 10_000.0, gainLoss: -1_500.0 },
    ],
    longTerm: [
      { description: "ALPHABET INC CLASS A", cusip: "02079K305", symbol: "GOOGL", qty: 100, acquired: "01/15/22", sold: "10/10/25", proceeds: 20_000.0, basis: 12_000.0, gainLoss: 8_000.0 },
      { description: "MICROSOFT CORP", cusip: "594918104", symbol: "MSFT", qty: 50, acquired: "05/20/23", sold: "09/25/25", proceeds: 15_000.0, basis: 18_000.0, gainLoss: -3_000.0 },
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Drawing helpers — coordinate system runs y-down from top-left.
// ty(yTopDown, fontSize) returns the pdf-lib bottom-up baseline coordinate.
// Interpretation: yTopDown is the TOP of the text's em-box (baseline below
// by one fontSize). To put a value cleanly inside a box of height h, pass
// y_top = y_box + h - 4 - fontSize so descenders sit just inside the bottom.
// ────────────────────────────────────────────────────────────────────────────

interface Ctx {
  page: PDFPage;
  reg: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

const BLACK = rgb(0, 0, 0);
const SHADE = rgb(0.93, 0.95, 0.97);

function ty(yTopDown: number, fontSize = 0): number {
  return PAGE_H - yTopDown - fontSize;
}

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fixed = abs.toFixed(2);
  const [whole, dec] = fixed.split(".");
  return sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + dec;
}

function widthOf(font: PDFFont, str: string, size: number): number {
  return font.widthOfTextAtSize(str, size);
}

function drawText(
  ctx: Ctx,
  str: string,
  x: number,
  yTopDown: number,
  opts: { size?: number; bold?: boolean; italic?: boolean; color?: ReturnType<typeof rgb> } = {},
) {
  const { size = 9, bold = false, italic = false, color = BLACK } = opts;
  const font = italic ? ctx.italic : bold ? ctx.bold : ctx.reg;
  ctx.page.drawText(str, { x, y: ty(yTopDown, size), size, font, color });
}

function drawTextRight(
  ctx: Ctx,
  str: string,
  xRight: number,
  yTopDown: number,
  opts: { size?: number; bold?: boolean; italic?: boolean } = {},
) {
  const { size = 9, bold = false, italic = false } = opts;
  const font = italic ? ctx.italic : bold ? ctx.bold : ctx.reg;
  drawText(ctx, str, xRight - widthOf(font, str, size), yTopDown, opts);
}

function drawTextCenter(
  ctx: Ctx,
  str: string,
  xCenter: number,
  yTopDown: number,
  opts: { size?: number; bold?: boolean; italic?: boolean } = {},
) {
  const { size = 9, bold = false, italic = false } = opts;
  const font = italic ? ctx.italic : bold ? ctx.bold : ctx.reg;
  drawText(ctx, str, xCenter - widthOf(font, str, size) / 2, yTopDown, opts);
}

/** Greedy word-wrap. Returns lines that each fit within `maxWidth` at `size`. */
function wrapText(font: PDFFont, text: string, maxWidth: number, size: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) {
      current = trial;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Draws word-wrapped text. Returns the y-coordinate one line-height below the last line. */
function drawWrapped(
  ctx: Ctx,
  text: string,
  x: number,
  yTopDown: number,
  maxWidth: number,
  opts: { size?: number; bold?: boolean; italic?: boolean; lineGap?: number } = {},
): number {
  const { size = 7, bold = false, italic = false, lineGap = 2 } = opts;
  const font = italic ? ctx.italic : bold ? ctx.bold : ctx.reg;
  const lines = wrapText(font, text, maxWidth, size);
  let y = yTopDown;
  for (const line of lines) {
    drawText(ctx, line, x, y, opts);
    y += size + lineGap;
  }
  return y;
}

function drawBox(
  ctx: Ctx,
  x: number,
  yTopDown: number,
  w: number,
  h: number,
  opts: { fill?: ReturnType<typeof rgb>; borderColor?: ReturnType<typeof rgb>; borderWidth?: number } = {},
) {
  const { fill, borderColor = BLACK, borderWidth = 0.5 } = opts;
  ctx.page.drawRectangle({ x, y: PAGE_H - yTopDown - h, width: w, height: h, color: fill, borderColor, borderWidth });
}

function drawLine(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts: { thickness?: number } = {},
) {
  const { thickness = 0.5 } = opts;
  ctx.page.drawLine({ start: { x: x1, y: PAGE_H - y1 }, end: { x: x2, y: PAGE_H - y2 }, thickness, color: BLACK });
}

function drawLabeledBox(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value?: string,
  opts: { fill?: ReturnType<typeof rgb>; valueAlign?: "left" | "right"; valueSize?: number; multilineValue?: string[] } = {},
) {
  const { fill, valueAlign = "right", valueSize = 10, multilineValue } = opts;
  drawBox(ctx, x, y, w, h, { fill });
  drawText(ctx, label, x + 2, y + 2, { size: 6, bold: true });
  if (multilineValue) {
    multilineValue.forEach((line, i) => {
      drawText(ctx, line, x + 4, y + 12 + i * 11, { size: 9 });
    });
  } else if (value) {
    const valueY = y + h - 4 - valueSize;
    if (valueAlign === "right") drawTextRight(ctx, value, x + w - 4, valueY, { size: valueSize });
    else drawText(ctx, value, x + 4, valueY, { size: valueSize });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Shared layout helpers
// ────────────────────────────────────────────────────────────────────────────

interface LineRow {
  label: string;
  value: string;
  bold?: boolean;
  italic?: boolean;
}

function drawColumn(
  ctx: Ctx,
  x: number,
  yStart: number,
  width: number,
  rows: LineRow[],
  opts: { size?: number; lineHeight?: number } = {},
): number {
  const { size = 8, lineHeight = 11 } = opts;
  let y = yStart;
  for (const row of rows) {
    drawText(ctx, row.label, x, y, { size, bold: row.bold, italic: row.italic });
    if (row.value) drawTextRight(ctx, row.value, x + width, y, { size, bold: row.bold, italic: row.italic });
    y += lineHeight;
  }
  return y;
}

/** Section title row: title (left, size 8 bold) + optional inline subtitle
 *  positioned right after title with a measured gap + optional OMB note
 *  right-aligned to width. Underlined. */
function drawSectionTitle(
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  title: string,
  subtitle?: string,
  ombNote?: string,
): number {
  drawText(ctx, title, x, y, { size: 8, bold: true });
  const titleW = widthOf(ctx.bold, title, 8);
  if (subtitle) {
    drawText(ctx, subtitle, x + titleW + 8, y, { size: 8, bold: true });
  }
  if (ombNote) {
    drawTextRight(ctx, ombNote, x + width, y + 2, { size: 6 });
  }
  drawLine(ctx, x, y + 12, x + width, y + 12, { thickness: 0.5 });
  return y + 18;
}

// ────────────────────────────────────────────────────────────────────────────
// W-2 (Helix Software, Inc.) — Copy B
// ────────────────────────────────────────────────────────────────────────────

async function buildW2(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const ctx: Ctx = { page, reg, bold, italic };

  const X0 = 40;
  const X_LEFT_END = 290;
  const X_PAIR_MID = 410;
  const X_BOX12 = 500;
  const X_END = 572;

  // Top row: SSN + OMB notice
  drawLabeledBox(ctx, X0, 80, X_LEFT_END - X0, 32, "a  Employee's social security number", MARCUS.ssn, {
    fill: SHADE, valueAlign: "left", valueSize: 11,
  });
  drawBox(ctx, X_LEFT_END, 80, X_END - X_LEFT_END, 32, { fill: SHADE });
  drawText(ctx, "OMB No. 1545-0008", X_LEFT_END + 4, 82, { size: 6, bold: true });
  drawText(ctx, "Safe, accurate,", X_LEFT_END + 4, 92, { size: 7 });
  drawText(ctx, "FAST! Use", X_LEFT_END + 4, 102, { size: 7 });
  drawTextRight(ctx, "IRS e-file", X_END - 4, 92, { size: 9, bold: true });
  drawTextRight(ctx, "www.irs.gov/efile", X_END - 4, 104, { size: 6 });

  // Row: EIN | Box 1 | Box 2
  let y = 112;
  drawLabeledBox(ctx, X0, y, X_LEFT_END - X0, 24, "b  Employer identification number (EIN)", HELIX.ein, { valueAlign: "left", valueSize: 10 });
  drawLabeledBox(ctx, X_LEFT_END, y, X_PAIR_MID - X_LEFT_END, 24, "1  Wages, tips, other compensation", fmtMoney(W2.box1));
  drawLabeledBox(ctx, X_PAIR_MID, y, X_END - X_PAIR_MID, 24, "2  Federal income tax withheld", fmtMoney(W2.box2));

  // Employer block (3 lines) spanning rows 2-4
  y += 24;
  drawLabeledBox(ctx, X0, y, X_LEFT_END - X0, 72, "c  Employer's name, address, and ZIP code", undefined, {
    multilineValue: [HELIX.name, HELIX.street, HELIX.cityStateZip],
  });
  drawLabeledBox(ctx, X_LEFT_END, y, X_PAIR_MID - X_LEFT_END, 24, "3  Social security wages", fmtMoney(W2.box3));
  drawLabeledBox(ctx, X_PAIR_MID, y, X_END - X_PAIR_MID, 24, "4  Social security tax withheld", fmtMoney(W2.box4));
  y += 24;
  drawLabeledBox(ctx, X_LEFT_END, y, X_PAIR_MID - X_LEFT_END, 24, "5  Medicare wages and tips", fmtMoney(W2.box5));
  drawLabeledBox(ctx, X_PAIR_MID, y, X_END - X_PAIR_MID, 24, "6  Medicare tax withheld", fmtMoney(W2.box6));
  y += 24;
  drawLabeledBox(ctx, X_LEFT_END, y, X_PAIR_MID - X_LEFT_END, 24, "7  Social security tips", "");
  drawLabeledBox(ctx, X_PAIR_MID, y, X_END - X_PAIR_MID, 24, "8  Allocated tips", "");

  // Row: Control number | Box 9 | Box 10
  y += 24;
  drawLabeledBox(ctx, X0, y, X_LEFT_END - X0, 24, "d  Control number", "");
  drawLabeledBox(ctx, X_LEFT_END, y, X_PAIR_MID - X_LEFT_END, 24, "9", "");
  drawLabeledBox(ctx, X_PAIR_MID, y, X_END - X_PAIR_MID, 24, "10  Dependent care benefits", "");

  // Row: Employee name | Box 11 | Box 12a
  y += 24;
  drawBox(ctx, X0, y, X_LEFT_END - X0, 24);
  drawText(ctx, "e  Employee's first name and initial", X0 + 2, y + 2, { size: 6, bold: true });
  drawText(ctx, "Last name", X0 + 130, y + 2, { size: 6, bold: true });
  drawText(ctx, "Suff.", X_LEFT_END - 26, y + 2, { size: 6, bold: true });
  drawText(ctx, MARCUS.firstName, X0 + 4, y + 10, { size: 10 });
  drawText(ctx, MARCUS.lastName, X0 + 130, y + 10, { size: 10 });
  drawLabeledBox(ctx, X_LEFT_END, y, X_BOX12 - X_LEFT_END, 24, "11  Nonqualified plans", "");
  drawLabeledBox(ctx, X_BOX12, y, X_END - X_BOX12, 24, "12a  See instructions for box 12", "");
  drawText(ctx, "D", X_BOX12 + 14, y + 10, { size: 10, bold: true });
  drawTextRight(ctx, fmtMoney(W2.box12d), X_END - 4, y + 10, { size: 10 });
  drawLine(ctx, X_BOX12 + 24, y + 12, X_BOX12 + 24, y + 24);

  // Row: Employee address line 1 | Box 13 checkboxes | Box 12b
  y += 24;
  drawLabeledBox(ctx, X0, y, X_LEFT_END - X0, 24, "f  Employee's address and ZIP code", MARCUS.street, { valueAlign: "left", valueSize: 10 });
  drawBox(ctx, X_LEFT_END, y, X_BOX12 - X_LEFT_END, 24);
  drawText(ctx, "13", X_LEFT_END + 2, y + 2, { size: 6, bold: true });
  const cb = (cx: number, cy: number) => drawBox(ctx, cx, cy, 8, 8, { borderWidth: 0.4 });
  cb(X_LEFT_END + 18, y + 12);
  drawText(ctx, "Statutory", X_LEFT_END + 28, y + 8, { size: 6 });
  drawText(ctx, "employee", X_LEFT_END + 28, y + 16, { size: 6 });
  cb(X_LEFT_END + 62, y + 12);
  drawText(ctx, "Retirement", X_LEFT_END + 72, y + 8, { size: 6 });
  drawText(ctx, "plan", X_LEFT_END + 72, y + 16, { size: 6 });
  drawText(ctx, "X", X_LEFT_END + 64, y + 13, { size: 7, bold: true });
  cb(X_LEFT_END + 122, y + 12);
  drawText(ctx, "Third-party", X_LEFT_END + 132, y + 8, { size: 6 });
  drawText(ctx, "sick pay", X_LEFT_END + 132, y + 16, { size: 6 });
  drawLabeledBox(ctx, X_BOX12, y, X_END - X_BOX12, 24, "12b", "");
  drawText(ctx, "W", X_BOX12 + 14, y + 10, { size: 10, bold: true });
  drawTextRight(ctx, fmtMoney(W2.box12w), X_END - 4, y + 10, { size: 10 });
  drawLine(ctx, X_BOX12 + 24, y + 12, X_BOX12 + 24, y + 24);

  // Row: Employee address line 2 | Box 14a | Box 12c
  y += 24;
  drawBox(ctx, X0, y, X_LEFT_END - X0, 24);
  drawText(ctx, MARCUS.cityStateZip, X0 + 4, y + 10, { size: 10 });
  drawLabeledBox(ctx, X_LEFT_END, y, X_BOX12 - X_LEFT_END, 24, "14  Other", W2.box14, { valueAlign: "left", valueSize: 9 });
  drawLabeledBox(ctx, X_BOX12, y, X_END - X_BOX12, 24, "12c", "");
  drawLine(ctx, X_BOX12 + 24, y + 12, X_BOX12 + 24, y + 24);

  // Row: (blank) | (blank) | Box 12d
  y += 24;
  drawBox(ctx, X0, y, X_LEFT_END - X0, 24);
  drawBox(ctx, X_LEFT_END, y, X_BOX12 - X_LEFT_END, 24);
  drawLabeledBox(ctx, X_BOX12, y, X_END - X_BOX12, 24, "12d", "");
  drawLine(ctx, X_BOX12 + 24, y + 12, X_BOX12 + 24, y + 24);

  // State row (15-20)
  y += 24;
  const stateCols = [
    { x: X0, w: 40, label: "15  State", value: "CA" },
    { x: X0 + 40, w: 100, label: "Employer's state ID number", value: HELIX.stateId },
    { x: X0 + 140, w: 90, label: "16  State wages, tips, etc.", value: fmtMoney(W2.box16), valueAlign: "right" as const },
    { x: X0 + 230, w: 80, label: "17  State income tax", value: fmtMoney(W2.box17), valueAlign: "right" as const },
    { x: X0 + 310, w: 70, label: "18  Local wages, tips, etc.", value: "" },
    { x: X0 + 380, w: 70, label: "19  Local income tax", value: "" },
    { x: X0 + 450, w: 82, label: "20  Locality name", value: "" },
  ];
  for (const c of stateCols) {
    drawLabeledBox(ctx, c.x, y, c.w, 28, c.label, c.value, { valueAlign: (c as { valueAlign?: "left" | "right" }).valueAlign ?? "left" });
  }
  y += 28;
  for (const c of stateCols) drawBox(ctx, c.x, y, c.w, 22);

  // Footer
  y += 32;
  drawText(ctx, "Form", X0, y + 6, { size: 9 });
  drawText(ctx, "W-2", X0 + 24, y, { size: 16, bold: true });
  drawText(ctx, "Wage and Tax Statement", X0 + 60, y + 6, { size: 10, bold: true });
  drawText(ctx, "2025", X0 + 200, y - 2, { size: 16, bold: true });
  drawTextRight(ctx, "Department of the Treasury—Internal Revenue Service", X_END, y + 8, { size: 8 });
  y += 22;
  drawText(ctx, "Copy B—To Be Filed With Employee's FEDERAL Tax Return.", X0, y, { size: 9, bold: true });
  y += 11;
  drawText(ctx, "This information is being furnished to the Internal Revenue Service.", X0, y, { size: 8 });

  return await doc.save();
}

// ────────────────────────────────────────────────────────────────────────────
// Wealthfront-style consolidated 1099 — 6 pages
// ────────────────────────────────────────────────────────────────────────────

interface WfHeaderOpts {
  page: number;
  totalPages: number;
  titleLabel?: string;
  continued?: boolean;
}

function drawWealthfrontHeader(ctx: Ctx, opts: WfHeaderOpts) {
  drawText(ctx, "Page", PAGE_W - 100, 22, { size: 8 });
  drawText(ctx, String(opts.page), PAGE_W - 76, 22, { size: 8 });
  drawText(ctx, "of", PAGE_W - 60, 22, { size: 8 });
  drawText(ctx, String(opts.totalPages), PAGE_W - 44, 22, { size: 8 });

  if (opts.page === 1) {
    const top = 40;
    drawBox(ctx, 36, top, PAGE_W - 72, 90, { fill: SHADE });
    drawText(ctx, WEALTHFRONT.payerName, 42, top + 4, { size: 10, bold: true });
    drawText(ctx, WEALTHFRONT.payerStreet, 42, top + 18, { size: 8 });
    drawText(ctx, WEALTHFRONT.payerCityStateZip, 42, top + 30, { size: 8 });
    drawText(ctx, "Customer Service:  " + WEALTHFRONT.payerPhone, 42, top + 42, { size: 8 });
    drawText(ctx, "PAYER'S TIN: " + WEALTHFRONT.payerTIN, 42, top + 75, { size: 8 });
    drawText(ctx, "Tax Information", 240, top + 6, { size: 11, bold: true });
    drawText(ctx, "Account  " + WEALTHFRONT.account, 240, top + 22, { size: 9, bold: true });
    drawText(ctx, "Statement Date:  " + WEALTHFRONT.statementDate, 380, top + 6, { size: 8 });
    drawText(ctx, "Document ID:  " + WEALTHFRONT.documentId, 380, top + 18, { size: 8 });
    // Right-align "2025" so it sits just inside the band's right edge
    drawTextRight(ctx, "2025", PAGE_W - 42, top + 4, { size: 22, bold: true });
    drawText(ctx, MARCUS.name, 240, top + 40, { size: 9 });
    drawText(ctx, MARCUS.street, 240, top + 52, { size: 9 });
    drawText(ctx, MARCUS.cityStateZip, 240, top + 64, { size: 9 });
    drawText(ctx, "RECIPIENT'S TIN: " + MARCUS.ssnMasked, 240, top + 75, { size: 8 });
  } else {
    // Continuation band: 30pt tall, contents centered vertically inside
    drawBox(ctx, 36, 32, PAGE_W - 72, 30, { fill: SHADE });
    drawText(ctx, WEALTHFRONT.payerName, 42, 38, { size: 9, bold: true });
    drawText(ctx, "2025", 42, 50, { size: 9, bold: true });
    if (opts.titleLabel) {
      drawTextCenter(ctx, opts.titleLabel, PAGE_W / 2, 38, { size: 10, bold: true });
      if (opts.continued) drawTextCenter(ctx, "(continued)", PAGE_W / 2, 50, { size: 8, italic: true });
    }
    drawTextRight(ctx, "Account  " + WEALTHFRONT.account, PAGE_W - 42, 38, { size: 8 });
    drawTextRight(ctx, WEALTHFRONT.statementDate, PAGE_W - 42, 50, { size: 8 });
  }
}

async function buildWealthfront1099(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  // ─── Page 1: Summary Information ────────────────────────────────────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawWealthfrontHeader(ctx, { page: 1, totalPages: 6 });

    drawTextCenter(ctx, "Summary Information", PAGE_W / 2, 140, { size: 11, bold: true });
    drawText(ctx, "11 - [ ] FATCA filing requirement (see instructions)", 42, 142, { size: 7 });
    drawText(ctx, "13 - [ ] FATCA filing requirement (see instructions)", PAGE_W - 230, 142, { size: 7 });

    const colLeftX = 42;
    const colRightX = 320;
    const colW = 250;

    let yL = drawSectionTitle(ctx, colLeftX, 160, colW, "DIVIDENDS AND DISTRIBUTIONS", "2025 1099-DIV*", "OMB No. 1545-0110");
    yL = drawColumn(ctx, colLeftX, yL, colW, [
      { label: "1a- Total ordinary dividends (includes lines 1b, 5, 2e)", value: "0.00" },
      { label: "1b- Qualified dividends", value: "0.00" },
      { label: "2a- Total capital gain distributions (includes lines 2b, 2c, 2d, 2f)", value: "0.00" },
      { label: "2b- Unrecaptured Section 1250 gain", value: "0.00" },
      { label: "2c- Section 1202 gain", value: "0.00" },
      { label: "2d- Collectibles (28%) gain", value: "0.00" },
      { label: "2e- Section 897 ordinary dividends", value: "0.00" },
      { label: "2f- Section 897 capital gain", value: "0.00" },
      { label: "3- Nondividend distributions", value: "0.00" },
      { label: "4- Federal income tax withheld", value: "0.00", bold: true },
      { label: "5- Section 199A dividends", value: "0.00" },
      { label: "6- Investment expenses", value: "0.00" },
      { label: "8- Foreign country or US possession:      7- Foreign tax paid:", value: "0.00" },
      { label: "9- Cash liquidation distributions", value: "0.00" },
      { label: "10- Noncash liquidation distributions", value: "0.00" },
      { label: "12- Exempt-interest dividends (includes line 13)", value: "0.00" },
      { label: "13- Specified private activity bond interest dividends (AMT)", value: "0.00" },
    ]);

    let yR = drawSectionTitle(ctx, colRightX, 160, colW, "MISCELLANEOUS INFORMATION", "2025 1099-MISC*", "OMB No. 1545-0115");
    yR = drawColumn(ctx, colRightX, yR, colW, [
      { label: "2- Royalties", value: "0.00" },
      { label: "3- Other income", value: "0.00" },
      { label: "4- Federal income tax withheld", value: "0.00", bold: true },
      { label: "8- Substitute payments in lieu of dividends or interest", value: "0.00" },
    ]);
    yR += 8;
    yR = drawSectionTitle(ctx, colRightX, yR, colW, "SECTION 1256 CONTRACTS", "2025 1099-B*", "OMB No. 1545-0715");
    yR = drawColumn(ctx, colRightX, yR, colW, [
      { label: "8- Profit or (loss) realized in 2025 on closed contracts", value: "0.00" },
      { label: "9- Unrealized profit or (loss) on open contracts-12/31/2024", value: "0.00" },
      { label: "10- Unrealized profit or (loss) on open contracts-12/31/2025", value: "0.00" },
      { label: "11- Aggregate profit or (loss) on contracts", value: "0.00" },
    ]);
    yR += 6;
    yR = drawWrapped(
      ctx,
      "If applicable, proceeds from sale transactions appear summarized below and are detailed in subsequent sections of this document.",
      colRightX, yR, colW, { size: 7, italic: true },
    );
    yR += 6;
    yR = drawWrapped(
      ctx,
      "* This is important tax information and is being furnished to the Internal Revenue Service. If you are required to file a return, a negligence penalty or other sanction may be imposed on you if this income is taxable and the IRS determines that it has not been reported.",
      colRightX, yR, colW, { size: 7, bold: true },
    );

    // Summary table — column x positions widened so "Undetermined" has room
    const tableY = Math.max(yL, yR) + 20;
    drawText(ctx, "SUMMARY OF PROCEEDS, GAINS & LOSSES, ADJUSTMENTS AND WITHHOLDING", colLeftX, tableY, { size: 9, bold: true });
    drawText(ctx, "Refer to the 1099-B and Proceeds not reported to the IRS pages to ensure that you consider all relevant items and to determine the correct gains and losses. The amounts shown below are for informational purposes.", colLeftX, tableY + 12, { size: 6, italic: true });

    const tHdrY = tableY + 32; // extra room for 2-line headers
    // Spread numeric columns so wide headers + wide values don't crash:
    //   PROC(332) → BASIS(387) → MKT(442) → WASH(502) → NET(570)
    const X_TERM = colLeftX;
    const X_TYPE = colLeftX + 60;
    const X_PROC = colLeftX + 290;
    const X_BASIS = colLeftX + 345;
    const X_MKT = colLeftX + 400;
    const X_WASH = colLeftX + 460;
    const X_NET = PAGE_W - 42;
    drawText(ctx, "Term", X_TERM, tHdrY, { size: 7, bold: true });
    drawText(ctx, "Form 8949 type", X_TYPE, tHdrY, { size: 7, bold: true });
    drawTextRight(ctx, "Proceeds", X_PROC, tHdrY, { size: 7, bold: true });
    drawTextRight(ctx, "Cost basis", X_BASIS, tHdrY, { size: 7, bold: true });
    drawTextRight(ctx, "Market", X_MKT, tHdrY - 5, { size: 7, bold: true });
    drawTextRight(ctx, "discount", X_MKT, tHdrY + 4, { size: 7, bold: true });
    drawTextRight(ctx, "Wash sale loss", X_WASH, tHdrY - 5, { size: 7, bold: true });
    drawTextRight(ctx, "disallowed", X_WASH, tHdrY + 4, { size: 7, bold: true });
    drawTextRight(ctx, "Net gain", X_NET, tHdrY - 5, { size: 7, bold: true });
    drawTextRight(ctx, "or loss(-)", X_NET, tHdrY + 4, { size: 7, bold: true });
    drawLine(ctx, colLeftX, tHdrY + 14, PAGE_W - 36, tHdrY + 14);

    const tRows: Array<[string, string, boolean]> = [
      ["Short", "A (basis reported to the IRS)", false],
      ["Short", "B (basis not reported to the IRS)", false],
      ["Short", "C (Form 1099-B not received)", false],
      ["", "Total Short-term", true],
      ["Long", "D (basis reported to the IRS)", false],
      ["Long", "E (basis not reported to the IRS)", false],
      ["Long", "F (Form 1099-B not received)", false],
      ["", "Total Long-term", true],
      ["Undetermined", "B or E (basis not reported to the IRS)", false],
      ["Undetermined", "C or F (Form 1099-B not received)", false],
      ["", "Total Undetermined-term", true],
      ["", "Grand total", true],
    ];
    let rowY = tHdrY + 20;
    for (const [term, ftype, isTotal] of tRows) {
      drawText(ctx, term, X_TERM, rowY, { size: 7, bold: isTotal });
      drawText(ctx, ftype, X_TYPE, rowY, { size: 7, bold: isTotal });
      drawTextRight(ctx, "0.00", X_PROC, rowY, { size: 7, bold: isTotal });
      drawTextRight(ctx, "0.00", X_BASIS, rowY, { size: 7, bold: isTotal });
      drawTextRight(ctx, "0.00", X_MKT, rowY, { size: 7, bold: isTotal });
      drawTextRight(ctx, "0.00", X_WASH, rowY, { size: 7, bold: isTotal });
      drawTextRight(ctx, "0.00", X_NET, rowY, { size: 7, bold: isTotal });
      rowY += 10;
    }
    rowY += 4;
    drawText(ctx, "Withholding", X_TERM, rowY, { size: 7, bold: true });
    drawText(ctx, "Amount", X_PROC - 30, rowY, { size: 7, bold: true });
    rowY += 10;
    drawText(ctx, "Federal income tax withheld", X_TERM, rowY, { size: 7 });
    drawTextRight(ctx, "0.00", X_PROC, rowY, { size: 7 });

    rowY += 18;
    drawText(ctx, "Changes to dividend tax classifications processed after your original tax form is issued for 2025 may require an amended tax form.", colLeftX, rowY, { size: 7, italic: true });
  }

  // ─── Page 2: Interest Income (the page that matters for Marcus) ──────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawWealthfrontHeader(ctx, { page: 2, totalPages: 6, titleLabel: "Summary Information", continued: true });

    const colLeftX = 42;
    const colRightX = 320;
    const colW = 250;

    let yL = drawSectionTitle(ctx, colLeftX, 80, colW, "INTEREST INCOME", "2025 1099-INT", "OMB No. 1545-0112");
    yL = drawWrapped(
      ctx,
      "This is important tax information and is being furnished to the Internal Revenue Service. If you are required to file a return, a negligence penalty or other sanction may be imposed on you if this income is taxable and the IRS determines that it has not been reported.",
      colLeftX,
      yL,
      colW,
      { size: 7, bold: true },
    );
    yL += 6;

    yL = drawColumn(ctx, colLeftX, yL, colW, [
      { label: "1- Interest income (not included in line 3)", value: fmtMoney(WEALTHFRONT.interestTotal), bold: true },
      { label: "2- Early withdrawal penalty", value: "0.00" },
      { label: "3- Interest on US Savings Bonds & Treasury obligations", value: "0.00" },
      { label: "4- Federal income tax withheld", value: "0.00", bold: true },
      { label: "5- Investment expenses", value: "0.00" },
      { label: "7- Foreign country or U.S. territory:      6- Foreign tax paid:", value: "0.00" },
      { label: "8- Tax-exempt interest (includes line 9)", value: "0.00" },
      { label: "9- Specified private activity bond interest (AMT)", value: "0.00" },
      { label: "10- Market discount (covered lots)", value: "0.00" },
      { label: "11- Bond premium (covered lots)", value: "0.00" },
      { label: "12- Bond premium on Treasury obligations (covered lots)", value: "0.00" },
      { label: "13- Bond premium on tax-exempt bonds (categorized below)", value: "0.00" },
      { label: "   Tax-exempt obligations (covered lots)", value: "0.00", italic: true },
      { label: "   Tax-exempt private activity obligations (AMT, covered lots)", value: "0.00", italic: true },
      { label: "14- Tax-exempt and tax credit bond CUSIP number", value: "See detail" },
      { label: "FATCA filing requirement [ ]", value: "" },
    ]);

    yL += 10;
    yL = drawWrapped(
      ctx,
      "The following amounts are not reported to the IRS. They are presented here for your reference when preparing your tax return(s).",
      colLeftX,
      yL,
      colW,
      { size: 7, italic: true },
    );
    yL += 6;
    yL = drawColumn(ctx, colLeftX, yL, colW, [
      { label: "Taxable accrued interest paid", value: "0.00" },
      { label: "Taxable accrued Treasury interest paid", value: "0.00" },
      { label: "Tax-exempt accrued interest paid", value: "0.00" },
      { label: "Tax-exempt accrued interest paid (AMT)", value: "0.00" },
      { label: "Taxable accrued nonqualified interest paid", value: "0.00" },
      { label: "Tax-exempt accrued nonqualified interest paid", value: "0.00" },
      { label: "Tax-exempt accrued nonqualified interest paid (AMT)", value: "0.00" },
      { label: "Nonqualified interest", value: "0.00" },
      { label: "Tax-exempt nonqualified interest", value: "0.00" },
      { label: "Tax-exempt nonqualified interest (AMT)", value: "0.00" },
      { label: "Interest shortfall on contingent payment debt", value: "0.00" },
      { label: "Bond premium- Non Treasury obligations (noncovered lots)", value: "0.00" },
      { label: "Bond premium- Treasury obligations (noncovered lots)", value: "0.00" },
      { label: "Bond premium- Tax-exempt obligations (noncovered lots)", value: "0.00" },
      { label: "Bond premium- Tax-exempt obligations (AMT, noncovered lots)", value: "0.00" },
      { label: "Market discount (noncovered lots)", value: "0.00" },
    ]);

    yL += 10;
    yL = drawSectionTitle(ctx, colLeftX, yL, colW, "STATE TAX WITHHELD");
    yL = drawWrapped(
      ctx,
      "Use the details of the State Tax Withholding page(s) to determine the appropriate amounts for your income tax return(s). The amounts shown in this section are for your reference.",
      colLeftX,
      yL,
      colW,
      { size: 7, italic: true },
    );
    yL += 6;
    drawColumn(ctx, colLeftX, yL, colW, [
      { label: "1099-DIV total withheld", value: "0.00" },
      { label: "1099-INT total withheld", value: "0.00" },
      { label: "1099-OID total withheld", value: "0.00" },
      { label: "1099-MISC total withheld", value: "0.00" },
      { label: "1099-B total withheld", value: "0.00" },
    ]);

    // Right column
    let yR = drawSectionTitle(ctx, colRightX, 80, colW, "ORIGINAL ISSUE DISCOUNT AND ADJUSTMENTS");
    yR = drawWrapped(
      ctx,
      "Use bond-by-bond details from the Form 1099-OID page(s) to determine amounts of Original Issue Discount income for your income tax return(s). The amounts shown in this section are for your reference when preparing your income tax return(s).",
      colRightX,
      yR,
      colW,
      { size: 7, italic: true },
    );
    yR += 6;
    yR = drawColumn(ctx, colRightX, yR, colW, [
      { label: "Original issue discount for the year", value: "0.00" },
      { label: "Acquisition premium (covered lots)", value: "0.00" },
      { label: "Acquisition premium (noncovered lots)", value: "0.00" },
      { label: "Original issue discount on Treasury obligations", value: "0.00" },
      { label: "Acquisition premium, Treasury obligations (covered lots)", value: "0.00" },
      { label: "Acquisition premium, Treasury obligations (noncovered lots)", value: "0.00" },
      { label: "Tax-exempt OID", value: "0.00" },
      { label: "Tax-exempt OID (lots not reported)", value: "0.00" },
      { label: "Acquisition premium (covered)", value: "0.00" },
      { label: "Acquisition premium (lots not reported)", value: "0.00" },
      { label: "Tax-exempt OID on private activity bonds", value: "0.00" },
      { label: "Tax-exempt OID on private activity bonds (lots not reported)", value: "0.00" },
      { label: "Acquisition premium (AMT, covered)", value: "0.00" },
      { label: "Acquisition premium (AMT, lots not reported)", value: "0.00" },
      { label: "Market discount (all lots)", value: "0.00" },
      { label: "Early withdrawal penalty", value: "0.00" },
      { label: "Investment expenses", value: "0.00" },
    ]);

    yR += 10;
    yR = drawSectionTitle(ctx, colRightX, yR, colW, "RECONCILIATIONS, FEES, EXPENSES AND EXPENDITURES");
    yR = drawWrapped(
      ctx,
      "The amounts in this section are not reported to the IRS. They are presented here for your reference when preparing your income tax return(s).",
      colRightX,
      yR,
      colW,
      { size: 7, italic: true },
    );
    yR += 6;
    drawColumn(ctx, colRightX, yR, colW, [
      { label: "Other Receipts & Reconciliations- Partnership distributions", value: "0.00" },
      { label: "Other Receipts & Reconciliations- Foreign tax paid- partnership", value: "0.00" },
      { label: "Other Receipts & Reconciliations- Return of principal", value: "0.00" },
      { label: "Other Receipts & Reconciliations- Deferred income payment", value: "0.00" },
      { label: "Other Receipts & Reconciliations- Deemed premium", value: "0.00" },
      { label: "Other Receipts & Reconciliations- Income accrual- UIT", value: "0.00" },
      { label: "Other Receipts & Reconciliations- Basis adjustments", value: "0.00" },
      { label: "Other Receipts & Reconciliations- Foreign tax pd beyond treaty", value: "0.00" },
      { label: "Fees & Expenses- Margin interest", value: "0.00" },
      { label: "Fees & Expenses- Dividends paid on short position", value: "0.00" },
      { label: "Fees & Expenses- Interest paid on short position", value: "0.00" },
      { label: "Fees & Expenses- Non reportable distribution expense", value: "0.00" },
      { label: "Fees & Expenses- Other expenses", value: "0.00" },
      { label: "Fees & Expenses- Severance tax", value: "0.00" },
      { label: "Fees & Expenses- Organizational expense", value: "0.00" },
      { label: "Fees & Expenses- Miscellaneous fees", value: "0.00" },
      { label: "Fees & Expenses- Tax-exempt investment expense", value: "0.00" },
      { label: "Foreign Exchange Gains & Losses- Foreign currency gain/loss", value: "0.00" },
    ]);
  }

  // ─── Page 3: Detail for Interest Income (monthly table) ──────────────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawWealthfrontHeader(ctx, { page: 3, totalPages: 6, titleLabel: "Detail for Interest Income" });

    const x0 = 42;
    const pageW = PAGE_W - 84;
    let introY = drawWrapped(
      ctx,
      "This section of your tax information statement contains the payment level detail of taxable interest and associated bond premium. Market discount will be shown here only if you have elected to recognize it currently rather than at the time of sale or maturity. Bond premium and market discount for covered tax lots are totaled on Form 1099-INT and reported to the IRS. For noncovered tax lots, they are totaled and presented beneath the 1099-INT for informational purposes and are not reported to the IRS.",
      x0, 80, pageW, { size: 7, italic: true },
    );
    introY += 6;
    drawWrapped(
      ctx,
      "To provide a complete picture of activity for each investment, we also include here nonreportable transactions such as accrued interest paid on purchases and payment or receipt of nonqualified interest. Other amounts, such as federal, state and foreign tax withheld and investment expenses are shown as negative amounts but do not net against the reportable income totals.",
      x0, introY, pageW, { size: 7, italic: true },
    );

    const hdrY = 150;
    drawText(ctx, "Security description", x0, hdrY, { size: 8, bold: true });
    drawText(ctx, "CUSIP and/or symbol", x0 + 130, hdrY, { size: 8, bold: true });
    drawText(ctx, "Date", x0 + 290, hdrY, { size: 8, bold: true });
    drawTextRight(ctx, "Amount", x0 + 380, hdrY, { size: 8, bold: true });
    drawText(ctx, "Transaction type", x0 + 400, hdrY, { size: 8, bold: true });
    drawText(ctx, "Notes", x0 + 480, hdrY, { size: 8, bold: true });
    drawLine(ctx, x0, hdrY + 11, PAGE_W - 36, hdrY + 11);

    let rowY = hdrY + 18;
    for (const row of WEALTHFRONT.monthlyInterest) {
      drawText(ctx, row.date, x0 + 290, rowY, { size: 8 });
      drawTextRight(ctx, row.amount.toFixed(2), x0 + 380, rowY, { size: 8 });
      drawText(ctx, "Interest", x0 + 400, rowY, { size: 8 });
      rowY += 11;
    }
    drawLine(ctx, x0 + 340, rowY - 4, x0 + 388, rowY - 4, { thickness: 0.4 });
    drawTextRight(ctx, fmtMoney(WEALTHFRONT.interestTotal), x0 + 380, rowY, { size: 8 });
    drawText(ctx, "Total Interest", x0 + 400, rowY, { size: 8 });
    rowY += 16;
    drawLine(ctx, x0 + 340, rowY - 4, x0 + 388, rowY - 4, { thickness: 0.7 });
    drawTextRight(ctx, fmtMoney(WEALTHFRONT.interestTotal), x0 + 380, rowY, { size: 8, bold: true });
    drawText(ctx, "Total Interest", x0 + 400, rowY, { size: 8, bold: true });
  }

  // ─── Page 4: Schedule of Management Fees ─────────────────────────────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawWealthfrontHeader(ctx, { page: 4, totalPages: 6, titleLabel: "Schedule of Management Fees" });

    const x0 = 100;
    const x1 = 440;
    drawText(ctx, "Description", x0, 90, { size: 8, bold: true });
    drawText(ctx, "Amount", x1, 90, { size: 8, bold: true });
    drawLine(ctx, x0, 101, PAGE_W - 100, 101);

    let y = 110;
    const rows: LineRow[] = [
      { label: "Total Regular Interest*", value: fmtMoney(WEALTHFRONT.interestTotal) },
      { label: "Total US Government Interest*", value: "0.00" },
      { label: "Total Dividends", value: "0.00" },
      { label: "Total Capital Gains Distributions", value: "0.00" },
      { label: "Realized Gross Capital Gains", value: "0.00" },
      { label: "Total Tax-Exempt Resident State and US Possessions*", value: "0.00" },
      { label: "Total Tax-Exempt Non-Resident State*", value: "0.00" },
      { label: "Miscellaneous Income", value: "0.00" },
      { label: "Total:", value: fmtMoney(WEALTHFRONT.interestTotal), bold: true },
    ];
    for (const r of rows) {
      drawText(ctx, r.label, x0, y, { size: 8, bold: r.bold });
      drawTextRight(ctx, r.value, x1 + 70, y, { size: 8, bold: r.bold });
      y += 12;
    }
    y += 14;
    drawText(ctx, "Management Fees Paid", x0, y, { size: 8 });
    drawTextRight(ctx, "0.00", x1 + 70, y, { size: 8 });

    const footY = 680;
    const footEnd = drawWrapped(
      ctx,
      "Please note that this illustrative calculation of the deductible portion of account management fees is provided as a service to you and is not reported to the Internal Revenue Service. The above calculation takes into account all items of taxable and tax-exempt gross income in the account that are reported on the enclosed 1099. Account level management fees may not be charged on some of the assets held in your account. Accordingly, if this applies to your account, you may wish to exclude gross income from those assets in making this calculation. You should consult with your tax advisor.",
      42, footY, PAGE_W - 84, { size: 6, italic: true },
    );
    drawText(ctx, "*  Excludes Accrued Interest Paid", 42, footEnd + 6, { size: 6 });
    drawText(ctx, "** Excludes US Government Dividends from Mutual Funds", 42, footEnd + 16, { size: 6 });
  }

  // ─── Page 5: Instructions for Recipient (abbreviated) ────────────────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawWealthfrontHeader(ctx, { page: 5, totalPages: 6 });

    drawTextCenter(ctx, "Instructions for Recipient", PAGE_W / 2, 80, { size: 11, bold: true });

    const x0 = 42;
    const x1 = 320;
    let y = 110;
    drawText(ctx, "Common Instructions for Recipient", x0, y, { size: 9, bold: true });
    y += 12;
    for (const l of [
      "Recipient's taxpayer identification number (TIN). For your protection,",
      "this form may show only the last four digits of your TIN.",
      "",
      "Account number. May show an account or other unique number the payer",
      "assigned to distinguish your account.",
      "",
      "FATCA filing requirement. If the FATCA filing requirement box is checked,",
      "the payer is reporting on Form 1099 to satisfy its chapter 4 account reporting",
      "requirement.",
      "",
      "Keep tax documents for your records.",
    ]) { drawText(ctx, l, x0, y, { size: 7 }); y += 9; }
    y += 8;
    drawText(ctx, "1099-INT Instructions for Recipient", x0, y, { size: 9, bold: true });
    y += 12;
    for (const l of [
      "Box 1. Shows taxable interest paid to you during the calendar year by the",
      "payer. This does not include interest shown in box 3.",
      "",
      "Box 2. Shows interest or principal forfeited because of early withdrawal of",
      "time savings.",
      "",
      "Box 3. Shows interest on U.S. Savings Bonds, Treasury bills, Treasury",
      "bonds, and Treasury notes. This interest is exempt from state and local",
      "income taxes.",
      "",
      "Box 4. Shows backup withholding. Generally, a payer must backup withhold",
      "if you did not furnish your TIN.",
    ]) { drawText(ctx, l, x0, y, { size: 7 }); y += 9; }

    y = 110;
    drawText(ctx, "Additional Box Notes", x1, y, { size: 9, bold: true });
    y += 12;
    for (const l of [
      "Box 5-13. State withholding and bond-related boxes — see IRS instructions.",
      "",
      "Box 14. Shows CUSIP number(s) for tax-exempt bond(s) on which tax-exempt",
      "interest was paid.",
      "",
      "Boxes 15-17. State tax withheld reporting lines.",
      "",
      "Future developments. For the latest information about developments",
      "related to Form 1099-INT and its instructions, such as legislation enacted",
      "after they were published, go to www.irs.gov/Form1099INT.",
      "",
      "Free File. Go to www.irs.gov/FreeFile to see if you qualify for no-cost",
      "online federal tax preparation, e-filing, and direct deposit or payment",
      "options.",
    ]) { drawText(ctx, l, x1, y, { size: 7 }); y += 9; }
  }

  // ─── Page 6: blank ────────────────────────────────────────────────────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawWealthfrontHeader(ctx, { page: 6, totalPages: 6 });
    drawTextCenter(ctx, "This page intentionally left blank.", PAGE_W / 2, 380, { size: 13 });
  }

  return await doc.save();
}

// ────────────────────────────────────────────────────────────────────────────
// Schwab-style consolidated 1099 — 5 pages
// ────────────────────────────────────────────────────────────────────────────

function drawSchwabHeader(ctx: Ctx, page: number, totalPages: number) {
  const x0 = 36;
  const xR = PAGE_W - 36;
  if (page === 1) {
    drawText(ctx, "1099 Consolidated Tax Statement", x0, 50, { size: 16, bold: true });
    drawText(ctx, "Tax Year 2025 - ORIGINAL", x0, 72, { size: 11 });
    drawText(ctx, "Date Issued", xR - 100, 50, { size: 8 });
    drawText(ctx, SCHWAB.statementDate, xR - 100, 60, { size: 9 });
    drawTextRight(ctx, `Page ${page} of ${totalPages}`, xR, 80, { size: 9, bold: true });
  } else {
    drawText(ctx, "1099 Consolidated Tax Statement", x0, 36, { size: 11, bold: true });
    drawText(ctx, "Tax Year 2025    Copy B For Recipient", x0, 52, { size: 9 });
    drawText(ctx, SCHWAB.payerName, xR - 200, 36, { size: 9, bold: true });
    drawText(ctx, SCHWAB.payerStreet, xR - 200, 48, { size: 8 });
    drawText(ctx, SCHWAB.payerCityStateZip, xR - 200, 58, { size: 8 });
    drawText(ctx, "Identification Number: " + SCHWAB.payerTIN, xR - 200, 70, { size: 8 });
    drawText(ctx, "Taxpayer ID Number: " + MARCUS.ssnMasked, xR - 200, 80, { size: 8 });
    drawText(ctx, "Account Number: " + SCHWAB.account, xR - 200, 90, { size: 8 });
    drawText(ctx, `Page ${page} of ${totalPages}`, xR - 200, 100, { size: 8, bold: true });
    drawText(ctx, "Customer Service: " + SCHWAB.payerPhone, xR - 200, 110, { size: 8, bold: true });
    drawText(ctx, "Name Reported to the IRS:", x0, 80, { size: 8 });
    drawText(ctx, MARCUS.name, x0, 92, { size: 10, bold: true });
    drawText(ctx, MARCUS.street, x0, 104, { size: 9 });
    drawText(ctx, MARCUS.cityStateZip, x0, 114, { size: 9 });
  }
}

async function buildSchwab1099(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const x0 = 36;
  const xR = PAGE_W - 36;

  // ─── Page 1: Cover ────────────────────────────────────────────────────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawSchwabHeader(ctx, 1, 5);

    drawText(ctx, "Account Mailing Address", x0, 110, { size: 9, bold: true });
    drawText(ctx, "Account Owner", x0, 124, { size: 8, bold: true });
    drawText(ctx, MARCUS.name.toUpperCase(), x0, 136, { size: 9 });
    drawText(ctx, MARCUS.street.toUpperCase(), x0, 148, { size: 9 });
    drawText(ctx, MARCUS.cityStateZip.toUpperCase(), x0, 160, { size: 9 });

    drawText(ctx, "Legal Name and Address Reported", x0, 184, { size: 9, bold: true });
    drawText(ctx, "to IRS and State Taxing Authorities", x0, 196, { size: 9, bold: true });
    drawText(ctx, MARCUS.name.toUpperCase(), x0, 210, { size: 9 });
    drawText(ctx, MARCUS.street.toUpperCase(), x0, 222, { size: 9 });
    drawText(ctx, MARCUS.cityStateZip.toUpperCase(), x0, 234, { size: 9 });

    drawText(ctx, "Account Number", 320, 110, { size: 9, bold: true });
    drawText(ctx, SCHWAB.account, 320, 122, { size: 9 });
    drawText(ctx, "Customer Service: " + SCHWAB.payerPhone, 320, 138, { size: 9, bold: true });
    drawText(ctx, "What's included in this packet:", 320, 158, { size: 9, bold: true });
    drawText(ctx, "Reportable to the IRS", 320, 174, { size: 8, bold: true });
    drawTextRight(ctx, "Page", xR, 174, { size: 8, bold: true });
    const included: Array<[string, string]> = [
      ["1099-DIV Dividends and Distributions", "2"],
      ["1099-INT Interest Income", "2"],
      ["1099-MISC Miscellaneous Information", "2"],
      ["1099-OID Original Issue Discount", "2"],
      ["1099-B Proceeds from Transactions", "2"],
      ["Details of 1099-DIV Dividends and Distributions", "3"],
      ["1099-B Totals Summary", "4"],
      ["Details of 1099-B Proceeds from Transactions", "5"],
    ];
    let listY = 186;
    for (const [label, p] of included) {
      drawText(ctx, label, 320, listY, { size: 8 });
      drawTextRight(ctx, p, xR, listY, { size: 8 });
      listY += 10;
    }
    drawText(ctx, "Non-Reportable to the IRS", 320, listY + 8, { size: 8, bold: true });
    drawTextRight(ctx, "Page", xR, listY + 8, { size: 8, bold: true });
    drawText(ctx, "(none)", 320, listY + 20, { size: 8 });

    const introY = 320;
    drawText(ctx, "This Charles Schwab & Co., Inc. 2025 Consolidated Tax Statement provides your official tax information for use when preparing your tax return. It is important to", x0, introY, { size: 7 });
    drawText(ctx, "note that the income information that was reported on your December account statement will not have included certain adjustments occurring after", x0, introY + 9, { size: 7 });
    drawText(ctx, "year-end but are reflected on your Form 1099 and are necessary for tax reporting purposes.", x0, introY + 18, { size: 7 });
    drawText(ctx, "The following tax documents are not included in this statement and are sent individually in separate mailings, if required: Forms 1099-R, 1099-Q,", x0, introY + 36, { size: 7 });
    drawText(ctx, "1042-S, 2439, 5498, 5498-ESA, Schedule K-1.", x0, introY + 45, { size: 7 });

    const warnY = PAGE_H - 120;
    drawBox(ctx, x0, warnY, PAGE_W - 72, 50, { fill: rgb(0.98, 0.95, 0.86) });
    drawText(ctx, "*** WARNING - CORRECTED TAX FORMS POSSIBLE ***", x0 + 10, warnY + 6, { size: 9, bold: true });
    drawText(ctx, "The Forms 1099 included in your Charles Schwab & Co., Inc. 2025 Consolidated Tax Statement were prepared based upon information provided by the issuer of", x0 + 10, warnY + 20, { size: 7 });
    drawText(ctx, "each security. The issuer may change the tax status of a distribution reported to you after the issuance of this 1099 Consolidated Tax Statement. If that occurs,", x0 + 10, warnY + 30, { size: 7 });
    drawText(ctx, "we may be required to send you one or more corrections.", x0 + 10, warnY + 40, { size: 7 });
  }

  // ─── Page 2: Box-by-box totals (1099-DIV / -INT / -MISC / -OID / -B) ─────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawSchwabHeader(ctx, 2, 5);

    drawText(ctx, "This is important tax information and is being furnished to the Internal Revenue Service. If you are required to file a return, a negligence penalty or other sanction", x0, 130, { size: 7 });
    drawText(ctx, "may be imposed on you if this income is taxable and the IRS determines that it has not been reported.", x0, 139, { size: 7 });

    const colLeftX = x0;
    const colRightX = 320;
    const colW = 250;

    const sectionHeader = (cx: number, cy: number, title: string, omb: string) => {
      drawBox(ctx, cx, cy, colW, 14, { fill: SHADE });
      drawText(ctx, title, cx + 4, cy + 3, { size: 7, bold: true });
      drawText(ctx, "BOX   " + omb, cx + 4, cy + 14 + 3, { size: 7, bold: true });
      return cy + 24;
    };

    let yL = sectionHeader(colLeftX, 160, "IRS 2025 FORM 1099-DIV - DIVIDENDS AND DISTRIBUTIONS", "OMB NO. 1545-0110");
    yL = drawColumn(ctx, colLeftX, yL, colW, [
      { label: "1a.  TOTAL ORDINARY DIVIDENDS", value: "$" + fmtMoney(SCHWAB.div.box1aOrdinary) },
      { label: "1b.  QUALIFIED DIVIDENDS", value: "$" + fmtMoney(SCHWAB.div.box1bQualified) },
      { label: "2a.  TOTAL CAPITAL GAIN DISTRIBUTIONS", value: "$0.00" },
      { label: "2b.  UNRECAP. SEC. 1250 GAIN", value: "$0.00" },
      { label: "2d.  COLLECTIBLES (28%) GAIN", value: "$0.00" },
      { label: "2e.  SECTION 897 ORDINARY DIVIDENDS", value: "$0.00" },
      { label: "2f.  SECTION 897 CAPITAL GAIN", value: "$0.00" },
      { label: "3.   NON-DIVIDEND DISTRIBUTIONS", value: "$0.00" },
      { label: "4.   FEDERAL INCOME TAX WITHHELD", value: "$0.00" },
      { label: "5.   SECTION 199A DIVIDENDS", value: "$0.00" },
      { label: "6.   INVESTMENT EXPENSES", value: "$0.00" },
      { label: "7.   FOREIGN TAX PAID", value: "$0.00" },
      { label: "9.   CASH LIQUIDATION DISTRIBUTIONS", value: "$0.00" },
      { label: "10.  NON-CASH LIQUIDATION DISTRIBUTIONS", value: "$0.00" },
      { label: "12.  EXEMPT-INTEREST DIVIDENDS", value: "$0.00" },
      { label: "13.  SPECIFIED PRIVATE ACTIVITY BOND INT. DIVS.", value: "$0.00" },
    ]);

    yL += 6;
    yL = sectionHeader(colLeftX, yL, "IRS 2025 FORM 1099-INT - INTEREST INCOME", "OMB NO. 1545-0112");
    yL = drawColumn(ctx, colLeftX, yL, colW, [
      { label: "1.   INTEREST INCOME", value: "$0.00" },
      { label: "2.   EARLY WITHDRAWAL PENALTY", value: "$0.00" },
      { label: "3.   INTEREST ON U.S. SAVINGS BONDS / TREAS.", value: "$0.00" },
      { label: "4.   FEDERAL INCOME TAX WITHHELD", value: "$0.00" },
      { label: "5.   INVESTMENT EXPENSES", value: "$0.00" },
      { label: "6.   FOREIGN TAX PAID", value: "$0.00" },
      { label: "8.   TAX-EXEMPT INTEREST", value: "$0.00" },
      { label: "9.   SPECIFIED PRIVATE ACTIVITY BOND INTEREST", value: "$0.00" },
      { label: "10.  MARKET DISCOUNT", value: "$0.00" },
      { label: "11.  BOND PREMIUM", value: "$0.00" },
      { label: "12.  BOND PREMIUM ON TREASURY OBLIGATIONS", value: "$0.00" },
      { label: "13.  BOND PREMIUM ON TAX-EXEMPT BOND", value: "$0.00" },
    ]);

    let yR = sectionHeader(colRightX, 160, "IRS 2025 FORM 1099-MISC - MISCELLANEOUS INFO", "OMB NO. 1545-0115");
    yR = drawColumn(ctx, colRightX, yR, colW, [
      { label: "1.   RENTS", value: "$0.00" },
      { label: "2.   ROYALTIES", value: "$0.00" },
      { label: "3.   OTHER INCOME", value: "$0.00" },
      { label: "4.   FEDERAL INCOME TAX WITHHELD", value: "$0.00" },
      { label: "8.   SUBSTITUTE PAYMENTS IN LIEU OF DIVS / INT", value: "$0.00" },
    ]);

    yR += 6;
    yR = sectionHeader(colRightX, yR, "IRS 2025 FORM 1099-OID - ORIGINAL ISSUE DISCOUNT", "OMB NO. 1545-0117");
    yR = drawColumn(ctx, colRightX, yR, colW, [
      { label: "1.   ORIGINAL ISSUE DISCOUNT FOR 2025", value: "$0.00" },
      { label: "2.   OTHER PERIODIC INTEREST", value: "$0.00" },
      { label: "4.   FEDERAL INCOME TAX WITHHELD", value: "$0.00" },
      { label: "5.   MARKET DISCOUNT", value: "$0.00" },
      { label: "6.   ACQUISITION PREMIUM", value: "$0.00" },
      { label: "8.   OID ON U.S. TREASURY OBLIGATIONS", value: "$0.00" },
      { label: "9.   INVESTMENT EXPENSES", value: "$0.00" },
      { label: "10.  BOND PREMIUM", value: "$0.00" },
      { label: "11.  TAX-EXEMPT OID", value: "$0.00" },
    ]);

    yR += 6;
    // Shrink long title font so it fits the column
    drawBox(ctx, colRightX, yR, colW, 14, { fill: SHADE });
    drawText(ctx, "IRS 2025 FORM 1099-B - PROCEEDS FROM BROKER & BARTER EXCHANGE", colRightX + 4, yR + 3, { size: 6.5, bold: true });
    drawText(ctx, "BOX   OMB NO. 1545-0715", colRightX + 4, yR + 14 + 3, { size: 7, bold: true });
    yR += 24;
    const stP = SCHWAB.trades.shortTerm.reduce((s, t) => s + t.proceeds, 0);
    const stB = SCHWAB.trades.shortTerm.reduce((s, t) => s + t.basis, 0);
    const ltP = SCHWAB.trades.longTerm.reduce((s, t) => s + t.proceeds, 0);
    const ltB = SCHWAB.trades.longTerm.reduce((s, t) => s + t.basis, 0);
    yR = drawColumn(ctx, colRightX, yR, colW, [
      { label: "1d.  PROCEEDS", value: "$" + fmtMoney(stP + ltP) },
      { label: "       COVERED SECURITIES", value: "$" + fmtMoney(stP + ltP) },
      { label: "       NONCOVERED SECURITIES", value: "$0.00" },
      { label: "1e.  COST BASIS OF COVERED SECURITIES", value: "$" + fmtMoney(stB + ltB) },
      { label: "1f.  ACCRUED MARKET DISCOUNT", value: "$0.00" },
      { label: "1g.  WASH SALE LOSS DISALLOWED", value: "$0.00" },
      { label: "4.   FEDERAL INCOME TAX WITHHELD", value: "$0.00" },
    ]);

    drawTextCenter(ctx, "IMPORTANT TAX INFORMATION -- PLEASE RETAIN FOR YOUR RECORDS", PAGE_W / 2, PAGE_H - 50, { size: 9, bold: true });
  }

  // ─── Page 3: 1099-DIV detail ─────────────────────────────────────────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawSchwabHeader(ctx, 3, 5);

    drawText(ctx, "1099-DIV   DIVIDENDS & DISTRIBUTIONS", x0, 140, { size: 12, bold: true });
    drawLine(ctx, x0, 154, xR, 154);
    drawText(ctx, "Ordinary Dividends", x0, 162, { size: 9, bold: true });

    const hdrY = 176;
    drawText(ctx, "DESCRIPTION", x0, hdrY, { size: 7, bold: true });
    drawText(ctx, "CUSIP", x0 + 180, hdrY, { size: 7, bold: true });
    drawText(ctx, "PAY DATE", x0 + 235, hdrY, { size: 7, bold: true });
    drawTextRight(ctx, "ORDINARY", x0 + 350, hdrY - 4, { size: 7, bold: true });
    drawTextRight(ctx, "DIVIDENDS", x0 + 350, hdrY + 4, { size: 7, bold: true });
    drawTextRight(ctx, "QUALIFIED", x0 + 420, hdrY - 4, { size: 7, bold: true });
    drawTextRight(ctx, "DIVIDENDS", x0 + 420, hdrY + 4, { size: 7, bold: true });
    drawTextRight(ctx, "FED INCOME", x0 + 485, hdrY - 4, { size: 7, bold: true });
    drawTextRight(ctx, "TAX WITHHELD", x0 + 485, hdrY + 4, { size: 7, bold: true });
    drawTextRight(ctx, "SECTION 199A", xR, hdrY - 4, { size: 7, bold: true });
    drawTextRight(ctx, "DIVIDENDS", xR, hdrY + 4, { size: 7, bold: true });
    drawLine(ctx, x0, hdrY + 14, xR, hdrY + 14);

    let rowY = hdrY + 22;
    for (const d of SCHWAB.div.detail) {
      drawText(ctx, d.description, x0, rowY, { size: 7 });
      drawText(ctx, d.cusip, x0 + 180, rowY, { size: 7 });
      drawText(ctx, d.payDate, x0 + 235, rowY, { size: 7 });
      drawTextRight(ctx, "$" + d.ord.toFixed(2), x0 + 350, rowY, { size: 7 });
      drawTextRight(ctx, "$" + d.qual.toFixed(2), x0 + 420, rowY, { size: 7 });
      drawTextRight(ctx, "$0.00", x0 + 485, rowY, { size: 7 });
      drawTextRight(ctx, "$0.00", xR, rowY, { size: 7 });
      rowY += 12;
    }
    rowY += 8;
    drawText(ctx, "Total Ordinary Dividends  1099-DIV box 1a", x0, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(SCHWAB.div.box1aOrdinary), x0 + 350, rowY, { size: 8, bold: true });
    rowY += 12;
    drawText(ctx, "Total Qualified Dividends  1099-DIV box 1b", x0, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(SCHWAB.div.box1bQualified), x0 + 420, rowY, { size: 8, bold: true });
  }

  // ─── Page 4: 1099-B totals summary ───────────────────────────────────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawSchwabHeader(ctx, 4, 5);

    drawText(ctx, "FORM 1099-B TOTALS SUMMARY", x0, 140, { size: 12, bold: true });
    drawLine(ctx, x0, 154, xR, 154);
    drawText(ctx, "REALIZED GAIN/LOSS SUMMARY", x0, 164, { size: 10, bold: true });
    drawLine(ctx, x0, 178, xR, 178);
    drawText(ctx, "Refer to Proceeds from Broker and Barter Exchange Transactions for detailed information regarding these summary values. The amounts shown below are for informational", x0, 186, { size: 7, italic: true });
    drawText(ctx, "purposes only.", x0, 195, { size: 7, italic: true });

    // Column x positions chosen so adjacent headers + values never overlap.
    // Layout: label area to ~270pt, then 5 numeric cols evenly spaced.
    const C_PROC = x0 + 290;
    const C_BASIS = x0 + 355;
    const C_MKT = x0 + 415;
    const C_WASH = x0 + 480;
    const C_NET = xR;
    const hdrY = 220;
    drawTextRight(ctx, "PROCEEDS", C_PROC, hdrY + 9, { size: 7, bold: true });
    drawTextRight(ctx, "COST BASIS", C_BASIS, hdrY + 9, { size: 7, bold: true });
    drawTextRight(ctx, "MARKET", C_MKT, hdrY, { size: 7, bold: true });
    drawTextRight(ctx, "DISCOUNT", C_MKT, hdrY + 9, { size: 7, bold: true });
    drawTextRight(ctx, "WASH SALE LOSS", C_WASH, hdrY, { size: 7, bold: true });
    drawTextRight(ctx, "DISALLOWED", C_WASH, hdrY + 9, { size: 7, bold: true });
    drawTextRight(ctx, "REALIZED GAIN", C_NET, hdrY, { size: 7, bold: true });
    drawTextRight(ctx, "OR (LOSS)", C_NET, hdrY + 9, { size: 7, bold: true });

    const stP = SCHWAB.trades.shortTerm.reduce((s, t) => s + t.proceeds, 0);
    const stB = SCHWAB.trades.shortTerm.reduce((s, t) => s + t.basis, 0);
    const stG = stP - stB;
    const ltP = SCHWAB.trades.longTerm.reduce((s, t) => s + t.proceeds, 0);
    const ltB = SCHWAB.trades.longTerm.reduce((s, t) => s + t.basis, 0);
    const ltG = ltP - ltB;
    const moneyOrParen = (g: number) => (g < 0 ? "$(" + fmtMoney(-g) + ")" : "$" + fmtMoney(g));

    let rowY = hdrY + 30;
    drawText(ctx, "SHORT-TERM GAIN OR (LOSSES) - REPORT ON FORM 8949, PART I", x0, rowY, { size: 8, bold: true });
    drawLine(ctx, x0, rowY + 9, xR, rowY + 9, { thickness: 0.3 });
    rowY += 14;
    const stRows: Array<[string, number, number, number]> = [
      ["Box A (basis reported to the IRS)", stP, stB, stG],
      ["Box A - Ordinary - (basis reported to the IRS)", 0, 0, 0],
      ["Box B (basis not reported to the IRS)", 0, 0, 0],
      ["Box B - Ordinary - (basis not reported to the IRS)", 0, 0, 0],
    ];
    for (const [lbl, p, c, g] of stRows) {
      drawText(ctx, lbl, x0, rowY, { size: 7 });
      drawTextRight(ctx, "$" + fmtMoney(p), C_PROC, rowY, { size: 7 });
      drawTextRight(ctx, "$" + fmtMoney(c), C_BASIS, rowY, { size: 7 });
      drawTextRight(ctx, "$0.00", C_MKT, rowY, { size: 7 });
      drawTextRight(ctx, "$0.00", C_WASH, rowY, { size: 7 });
      drawTextRight(ctx, moneyOrParen(g), C_NET, rowY, { size: 7 });
      rowY += 11;
    }
    drawText(ctx, "Total Short - Term", x0 + 80, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(stP), C_PROC, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(stB), C_BASIS, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$0.00", C_MKT, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$0.00", C_WASH, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(stG), C_NET, rowY, { size: 8, bold: true });

    rowY += 22;
    drawText(ctx, "LONG-TERM GAIN OR (LOSSES) - REPORT ON FORM 8949, PART II", x0, rowY, { size: 8, bold: true });
    drawLine(ctx, x0, rowY + 9, xR, rowY + 9, { thickness: 0.3 });
    rowY += 14;
    const ltRows: Array<[string, number, number, number]> = [
      ["Box D (basis reported to the IRS)", ltP, ltB, ltG],
      ["Box D - Ordinary - (basis reported to the IRS)", 0, 0, 0],
      ["Box E (basis not reported to the IRS)", 0, 0, 0],
      ["Box E - Ordinary - (basis not reported to the IRS)", 0, 0, 0],
    ];
    for (const [lbl, p, c, g] of ltRows) {
      drawText(ctx, lbl, x0, rowY, { size: 7 });
      drawTextRight(ctx, "$" + fmtMoney(p), C_PROC, rowY, { size: 7 });
      drawTextRight(ctx, "$" + fmtMoney(c), C_BASIS, rowY, { size: 7 });
      drawTextRight(ctx, "$0.00", C_MKT, rowY, { size: 7 });
      drawTextRight(ctx, "$0.00", C_WASH, rowY, { size: 7 });
      drawTextRight(ctx, moneyOrParen(g), C_NET, rowY, { size: 7 });
      rowY += 11;
    }
    drawText(ctx, "Total Long - Term", x0 + 80, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(ltP), C_PROC, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(ltB), C_BASIS, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$0.00", C_MKT, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$0.00", C_WASH, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(ltG), C_NET, rowY, { size: 8, bold: true });

    rowY += 22;
    drawText(ctx, "UNKNOWN TERM - CODE (X) REPORT ON FORM 8949, PART I OR PART II", x0, rowY, { size: 8, bold: true });
    drawLine(ctx, x0, rowY + 9, xR, rowY + 9, { thickness: 0.3 });
    rowY += 14;
    for (const lbl of [
      "Box B or Box E (basis not reported to the IRS)",
      "Box B or Box E - Ordinary - (basis not reported to the IRS)",
    ]) {
      drawText(ctx, lbl, x0, rowY, { size: 7 });
      for (const cx of [C_PROC, C_BASIS, C_MKT, C_WASH, C_NET]) drawTextRight(ctx, "$0.00", cx, rowY, { size: 7 });
      rowY += 11;
    }
    drawText(ctx, "Total Unknown Term", x0 + 80, rowY, { size: 8, bold: true });
    for (const cx of [C_PROC, C_BASIS, C_MKT, C_WASH, C_NET]) drawTextRight(ctx, "$0.00", cx, rowY, { size: 8, bold: true });

    rowY += 22;
    drawText(ctx, "REGULATED FUTURES CONTRACTS", x0, rowY, { size: 8, bold: true });
    drawTextRight(ctx, "AMOUNT", C_PROC, rowY, { size: 8, bold: true });
    drawLine(ctx, x0, rowY + 9, xR, rowY + 9, { thickness: 0.3 });
    rowY += 14;
    for (const lbl of [
      "Profit or (loss) realized in 2025 - closed contracts",
      "Unrealized Profit or (loss) on open contracts 12/31/2024",
      "Unrealized Profit or (loss) on open contracts 12/31/2025",
    ]) {
      drawText(ctx, lbl, x0, rowY, { size: 7 });
      drawTextRight(ctx, "$0.00", C_PROC, rowY, { size: 7 });
      rowY += 11;
    }
    drawText(ctx, "Aggregate profit or (loss) on contracts", x0, rowY, { size: 7, bold: true });
    drawTextRight(ctx, "$0.00", C_PROC, rowY, { size: 7, bold: true });
  }

  // ─── Page 5: 1099-B per-trade detail ─────────────────────────────────────
  {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const ctx: Ctx = { page, reg, bold, italic };
    drawSchwabHeader(ctx, 5, 5);

    drawText(ctx, "1099-B   PROCEEDS FROM BROKER AND BARTER EXCHANGE TRANSACTIONS", x0, 140, { size: 11, bold: true });
    drawLine(ctx, x0, 154, xR, 154);

    let y = 168;

    // 6 right-aligned numeric columns; gaps sized so that size-8-bold totals
    // ("$57,500.00" ≈ 45pt, "$(3,000.00)" ≈ 48pt) never crash adjacent cols.
    // PROC pushed right of SOLD date by ≥10pt; GAIN pulled left of WHELD by
    // enough to clear the "TAX WITHHELD" header at size 6 bold.
    const C_QTY = x0 + 140;
    const C_ACQ = x0 + 180;
    const C_SOLD = x0 + 240;
    const C_PROC = x0 + 315;
    const C_BASIS = x0 + 370;
    const C_MKT = x0 + 400;
    const C_WASH = x0 + 440;
    const C_GAIN = x0 + 490;
    const C_WHELD = xR; // 576

    const moneyOrParen = (g: number) => (g < 0 ? "$(" + fmtMoney(-g) + ")" : "$" + fmtMoney(g));

    const HSZ = 5.5; // header font size; smaller than 6 so neighbouring
                     // column labels like "DISALLOWED" / "TAX WITHHELD" fit.
    const drawTradeHeader = () => {
      drawText(ctx, "DESCRIPTION", x0, y, { size: HSZ, bold: true });
      drawText(ctx, "(Box 1a)", x0, y + 7, { size: HSZ, bold: true });
      drawTextRight(ctx, "QUANTITY", C_QTY, y, { size: HSZ, bold: true });
      drawText(ctx, "DATE", C_ACQ - 5, y, { size: HSZ, bold: true });
      drawText(ctx, "ACQUIRED", C_ACQ - 5, y + 7, { size: HSZ, bold: true });
      drawText(ctx, "(Box 1b)", C_ACQ - 5, y + 14, { size: HSZ, bold: true });
      drawText(ctx, "DATE", C_SOLD - 5, y, { size: HSZ, bold: true });
      drawText(ctx, "SOLD", C_SOLD - 5, y + 7, { size: HSZ, bold: true });
      drawText(ctx, "(Box 1c)", C_SOLD - 5, y + 14, { size: HSZ, bold: true });
      drawTextRight(ctx, "PROCEEDS", C_PROC, y, { size: HSZ, bold: true });
      drawTextRight(ctx, "(Box 1d)", C_PROC, y + 14, { size: HSZ, bold: true });
      drawTextRight(ctx, "COST OR OTHER", C_BASIS, y, { size: HSZ, bold: true });
      drawTextRight(ctx, "BASIS", C_BASIS, y + 7, { size: HSZ, bold: true });
      drawTextRight(ctx, "(Box 1e)", C_BASIS, y + 14, { size: HSZ, bold: true });
      drawTextRight(ctx, "ACCRUED", C_MKT, y, { size: HSZ, bold: true });
      drawTextRight(ctx, "MKT DISC.", C_MKT, y + 7, { size: HSZ, bold: true });
      drawTextRight(ctx, "(Box 1f)", C_MKT, y + 14, { size: HSZ, bold: true });
      drawTextRight(ctx, "WASH SALE", C_WASH, y, { size: HSZ, bold: true });
      drawTextRight(ctx, "DISALLOWED", C_WASH, y + 7, { size: HSZ, bold: true });
      drawTextRight(ctx, "(Box 1g)", C_WASH, y + 14, { size: HSZ, bold: true });
      drawTextRight(ctx, "GAIN/(LOSS)", C_GAIN, y, { size: HSZ, bold: true });
      drawTextRight(ctx, "AMOUNT", C_GAIN, y + 7, { size: HSZ, bold: true });
      drawTextRight(ctx, "FED INCOME", C_WHELD, y, { size: HSZ, bold: true });
      drawTextRight(ctx, "TAX WITHHELD", C_WHELD, y + 7, { size: HSZ, bold: true });
      drawTextRight(ctx, "(Box 4)", C_WHELD, y + 14, { size: HSZ, bold: true });
      y += 26;
      drawLine(ctx, x0, y - 2, xR, y - 2);
    };

    const drawSection = (title: string, trades: typeof SCHWAB.trades.shortTerm) => {
      drawText(ctx, title, x0, y, { size: 9, bold: true });
      y += 14;
      drawTradeHeader();
      let secP = 0, secB = 0, secG = 0;
      for (const t of trades) {
        drawText(ctx, t.description, x0, y, { size: 8, bold: true });
        drawText(ctx, "CUSIP: " + t.cusip, x0 + 115, y, { size: 7 });
        drawText(ctx, "Symbol: " + t.symbol, x0 + 215, y, { size: 7, bold: true });
        y += 11;
        drawTextRight(ctx, t.qty.toFixed(3), C_QTY, y, { size: 7 });
        drawText(ctx, t.acquired, C_ACQ - 5, y, { size: 7 });
        drawText(ctx, t.sold, C_SOLD - 5, y, { size: 7 });
        drawTextRight(ctx, "$" + fmtMoney(t.proceeds), C_PROC, y, { size: 7 });
        drawTextRight(ctx, "$" + fmtMoney(t.basis), C_BASIS, y, { size: 7 });
        drawTextRight(ctx, "$0.00", C_MKT, y, { size: 7 });
        drawTextRight(ctx, "$0.00", C_WASH, y, { size: 7 });
        drawTextRight(ctx, moneyOrParen(t.gainLoss), C_GAIN, y, { size: 7 });
        drawTextRight(ctx, "$0.00", C_WHELD, y, { size: 7 });
        y += 12;
        drawText(ctx, "Security Subtotal", x0 + 60, y, { size: 7, italic: true });
        drawTextRight(ctx, "$" + fmtMoney(t.proceeds), C_PROC, y, { size: 7 });
        drawTextRight(ctx, "$" + fmtMoney(t.basis), C_BASIS, y, { size: 7 });
        drawTextRight(ctx, "$0.00", C_MKT, y, { size: 7 });
        drawTextRight(ctx, "$0.00", C_WASH, y, { size: 7 });
        drawTextRight(ctx, moneyOrParen(t.gainLoss), C_GAIN, y, { size: 7 });
        drawTextRight(ctx, "$0.00", C_WHELD, y, { size: 7 });
        y += 14;
        secP += t.proceeds;
        secB += t.basis;
        secG += t.gainLoss;
      }
      const totalLabel = title.startsWith("Short") ? "Total Short Term - Covered Securities" : "Total Long Term - Covered Securities";
      drawText(ctx, totalLabel, x0, y, { size: 8, bold: true });
      drawTextRight(ctx, "$" + fmtMoney(secP), C_PROC, y, { size: 8, bold: true });
      drawTextRight(ctx, "$" + fmtMoney(secB), C_BASIS, y, { size: 8, bold: true });
      drawTextRight(ctx, "$0.00", C_MKT, y, { size: 8, bold: true });
      drawTextRight(ctx, "$0.00", C_WASH, y, { size: 8, bold: true });
      drawTextRight(ctx, moneyOrParen(secG), C_GAIN, y, { size: 8, bold: true });
      drawTextRight(ctx, "$0.00", C_WHELD, y, { size: 8, bold: true });
      y += 22;
      return { secP, secB, secG };
    };

    const stT = drawSection("Short Term - Covered Securities", SCHWAB.trades.shortTerm);
    const ltT = drawSection("Long Term - Covered Securities", SCHWAB.trades.longTerm);

    const totP = stT.secP + ltT.secP;
    const totB = stT.secB + ltT.secB;
    const totG = stT.secG + ltT.secG;
    drawText(ctx, "Total Covered and Noncovered Securities", x0, y, { size: 9, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(totP), C_PROC, y, { size: 9, bold: true });
    drawTextRight(ctx, "$" + fmtMoney(totB), C_BASIS, y, { size: 9, bold: true });
    drawTextRight(ctx, "$0.00", C_MKT, y, { size: 9, bold: true });
    drawTextRight(ctx, "$0.00", C_WASH, y, { size: 9, bold: true });
    drawTextRight(ctx, moneyOrParen(totG), C_GAIN, y, { size: 9, bold: true });
    drawTextRight(ctx, "$0.00", C_WHELD, y, { size: 9, bold: true });
  }

  return await doc.save();
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const docsDir = join(dirname(__filename), "docs");
  await mkdir(docsDir, { recursive: true });

  const w2 = await buildW2();
  await writeFile(join(docsDir, "01-marcus-w2.pdf"), w2);
  console.log(`✓ 01-marcus-w2.pdf (${(w2.length / 1024).toFixed(1)} KB)`);

  const wf = await buildWealthfront1099();
  await writeFile(join(docsDir, "02-marcus-1099-wealthfront.pdf"), wf);
  console.log(`✓ 02-marcus-1099-wealthfront.pdf (${(wf.length / 1024).toFixed(1)} KB)`);

  const schwab = await buildSchwab1099();
  await writeFile(join(docsDir, "03-marcus-1099-schwab.pdf"), schwab);
  console.log(`✓ 03-marcus-1099-schwab.pdf (${(schwab.length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
