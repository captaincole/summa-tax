// Render a debug version of a fillable PDF where every text field is
// stamped with its own field name (or the trailing numeric ID for fields
// named like "540_form_1024"). Lets you visually map line numbers →
// field IDs by opening the rendered PDF and reading what's in each cell.
//
// Run:
//   npx tsx scripts/labelPdfFields.ts <input.pdf> <output.pdf>
//
// Example:
//   npx tsx scripts/labelPdfFields.ts ref/forms/state/ca/2025-540.pdf \
//     /tmp/ca-540-labeled.pdf

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup } from "pdf-lib";

async function main() {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error("usage: npx tsx scripts/labelPdfFields.ts <input.pdf> <output.pdf>");
    process.exit(1);
  }

  const pdf = await PDFDocument.load(readFileSync(resolve(inPath)));
  const form = pdf.getForm();
  const fields = form.getFields();

  let labeled = 0;
  let skipped = 0;

  for (const f of fields) {
    const fullName = f.getName();
    // For fields like "540_form_1024" → use just the trailing numeric ID
    // ("1024"). For others, use the last dot-separated segment to keep
    // the label short enough to fit in tight cells.
    const numericMatch = fullName.match(/_(\d+)(?:\s*CB|\s*RB)?$/);
    const tailMatch = fullName.match(/([^.\[\]]+)\[\d+\]\s*$/);
    const label = numericMatch
      ? numericMatch[1]
      : tailMatch
        ? tailMatch[1]
        : fullName.slice(-12);

    if (f instanceof PDFTextField) {
      try {
        f.setText(label);
        f.setFontSize(8);
        labeled++;
      } catch (err) {
        console.warn(`setText failed for ${fullName}:`, err);
        skipped++;
      }
    } else if (f instanceof PDFCheckBox) {
      // Check every checkbox so we can see them in the rendered output;
      // their position tells us which is which by visual context.
      try {
        f.check();
        labeled++;
      } catch {
        skipped++;
      }
    } else if (f instanceof PDFRadioGroup) {
      // Skip — they're already labeled by their option text.
      skipped++;
    } else {
      skipped++;
    }
  }

  // Don't flatten — leave the form interactive so future passes can
  // continue editing if needed.
  const bytes = await pdf.save();
  writeFileSync(resolve(outPath), bytes);

  console.log(`Labeled ${labeled} fields, skipped ${skipped}.`);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
