/**
 * Dump every AcroForm field in the blank IRS Form 1040 so we can map our
 * draft1040 line values to the correct field names.
 *
 *   npm run inspect:1040
 */
import { PDFDocument, PDFTextField, PDFCheckBox } from "pdf-lib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pdfPath = resolve(projectRoot, "ref/forms/f1040-2025.pdf");

async function main() {
  const bytes = readFileSync(pdfPath);
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  const fields = form.getFields();
  console.log(`Total fields: ${fields.length}\n`);
  for (const f of fields) {
    const type = f.constructor.name;
    const name = f.getName();
    let extra = "";
    if (f instanceof PDFTextField) {
      extra = ` maxLength=${f.getMaxLength() ?? ""}`;
    } else if (f instanceof PDFCheckBox) {
      extra = ` checked=${f.isChecked()}`;
    }
    console.log(`${type.padEnd(15)}  ${name}${extra}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
