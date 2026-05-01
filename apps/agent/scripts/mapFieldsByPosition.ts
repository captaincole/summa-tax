/**
 * Dump every field with its page number and bounding-box position, sorted
 * top-to-bottom then left-to-right. Combined with knowledge of the 1040
 * visual layout, this tells us which field name sits on which line.
 */
import { PDFDocument, PDFTextField, PDFCheckBox } from "pdf-lib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const blankPath = resolve(projectRoot, "ref/forms/f1040-2025.pdf");

function shortName(fullName: string): string {
  const segs = fullName.split(".");
  const last = segs[segs.length - 1] ?? fullName;
  return last.replace(/\[\d+\]$/, "");
}

async function main() {
  const bytes = readFileSync(blankPath);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const pages = pdf.getPages();

  type Row = {
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
    kind: string;
    name: string;
  };
  const rows: Row[] = [];

  for (const f of form.getFields()) {
    const widgets = (f as any).acroField.getWidgets();
    const kind = f instanceof PDFTextField ? "T" : f instanceof PDFCheckBox ? "C" : "?";
    const name = shortName(f.getName());
    for (const w of widgets) {
      const r = w.getRectangle();
      // Find which page this widget sits on.
      let pageIdx = 0;
      for (let i = 0; i < pages.length; i++) {
        const ann = pages[i].node.Annots();
        if (ann && (ann as any).asArray().some((a: any) => a === w.dict)) {
          pageIdx = i;
          break;
        }
      }
      rows.push({
        page: pageIdx,
        x: r.x,
        y: r.y,
        w: r.width,
        h: r.height,
        kind,
        name,
      });
    }
  }

  rows.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    // Higher Y = higher on page (PDF origin is bottom-left)
    if (Math.abs(a.y - b.y) > 3) return b.y - a.y;
    return a.x - b.x;
  });

  for (const r of rows) {
    console.log(
      `p${r.page} y=${r.y.toFixed(0).padStart(3)} x=${r.x.toFixed(0).padStart(3)} w=${r.w.toFixed(0).padStart(3)} ${r.kind} ${r.name}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
