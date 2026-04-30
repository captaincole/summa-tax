// Dump AcroForm field names + types from a PDF. Used to discover the
// field-name conventions for new form templates so we can build line-value
// → field-name maps.
//
// Run:
//   npx tsx scripts/inspectPdfFields.ts ref/forms/f1040sd.pdf
//   npx tsx scripts/inspectPdfFields.ts ref/forms/f8949.pdf
//   npx tsx scripts/inspectPdfFields.ts ref/forms/state/ca/2025-540.pdf

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } from "pdf-lib";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npx tsx scripts/inspectPdfFields.ts <pdf-path>");
    process.exit(1);
  }
  const fullPath = resolve(path);
  const bytes = readFileSync(fullPath);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const fields = form.getFields();

  console.log(`File: ${fullPath}`);
  console.log(`Total fields: ${fields.length}\n`);

  for (const f of fields) {
    const name = f.getName();
    let kind = "unknown";
    let info = "";
    if (f instanceof PDFTextField) {
      kind = "text";
      info = ` value="${f.getText() ?? ""}"`;
    } else if (f instanceof PDFCheckBox) {
      kind = "checkbox";
      info = ` checked=${f.isChecked()}`;
    } else if (f instanceof PDFRadioGroup) {
      kind = "radio";
      info = ` options=[${f.getOptions().join(", ")}]`;
    } else if (f instanceof PDFDropdown) {
      kind = "dropdown";
      info = ` options=[${f.getOptions().join(", ")}]`;
    }
    console.log(`  [${kind.padEnd(8)}] ${name}${info}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
