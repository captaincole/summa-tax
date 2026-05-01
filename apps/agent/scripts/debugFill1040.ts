/**
 * Writes a debug-filled copy of the blank 1040 where every text field is
 * tagged with its short field name (e.g. "f1_04") and every checkbox is
 * checked. Open /tmp/1040-debug.pdf to see which field maps to which
 * visual position on the form.
 */
import { PDFDocument, PDFTextField, PDFCheckBox } from "pdf-lib";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const blankPath = resolve(projectRoot, "ref/forms/f1040-2025.pdf");
const outPath = "/tmp/1040-debug.pdf";

function shortName(fullName: string): string {
  const segments = fullName.split(".");
  const last = segments[segments.length - 1] ?? fullName;
  return last.replace(/\[\d+\]$/, "");
}

async function main() {
  const bytes = readFileSync(blankPath);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();

  for (const f of form.getFields()) {
    const short = shortName(f.getName());
    if (f instanceof PDFTextField) {
      try {
        f.setText(short);
      } catch {
        // ignore — some fields have stricter format validators
      }
    } else if (f instanceof PDFCheckBox) {
      f.check();
    }
  }

  const outBytes = await pdf.save();
  writeFileSync(outPath, outBytes);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
