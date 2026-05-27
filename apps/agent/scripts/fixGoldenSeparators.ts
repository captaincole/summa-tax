// One-shot: replace period-as-thousands-separator with comma in CPA-prepared
// goldens. Some CPA tools fill PDFs with "18.422" (European convention)
// instead of "18,422" — our renderer + every other US-style golden uses
// comma. We standardize to comma to match.
//
// Usage: npx tsx scripts/fixGoldenSeparators.ts path/to/Golden.pdf [more.pdf ...]
// Edits in place. Prints what it changed.

import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFTextField } from "pdf-lib";

// Matches a string that is digits-with-a-period-thousands-separator only.
// "18.422" → yes. "1.234.567" → yes. "12.5" → no (looks like a decimal).
// "1,234.56" → no (already comma-separated; decimal point intact).
const PERIOD_THOUSANDS = /^\d{1,3}(\.\d{3})+$/;

async function fixFile(path: string): Promise<void> {
  const bytes = readFileSync(path);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  let changed = 0;
  for (const field of form.getFields()) {
    if (!(field instanceof PDFTextField)) continue;
    const v = field.getText();
    if (!v) continue;
    const trimmed = v.trim();
    if (!PERIOD_THOUSANDS.test(trimmed)) continue;
    const fixed = trimmed.replace(/\./g, ",");
    field.setText(fixed);
    console.log(`  ${field.getName()}: ${JSON.stringify(v)} → ${JSON.stringify(fixed)}`);
    changed++;
  }
  if (changed === 0) {
    console.log(`  no changes`);
    return;
  }
  const out = await pdf.save();
  writeFileSync(path, out);
  console.log(`  wrote ${changed} change(s) to ${path}`);
}

async function main() {
  const paths = process.argv.slice(2);
  if (paths.length === 0) {
    console.error("Usage: fixGoldenSeparators.ts <pdf> [<pdf>...]");
    process.exit(1);
  }
  for (const p of paths) {
    console.log(`\n${p}`);
    await fixFile(p);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
