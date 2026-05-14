// One-off patch for tests/scenarios/alex/docs/Alex-1040-Golden.pdf.
//
// Fixes two oversights from when the golden was assembled by hand:
//   1. f2_17 (line 25a — W-2 withholding) and f2_29 (line 33 — total
//      payments) were saved with no comma separators; every other money
//      widget on the form uses comma grouping.
//   2. The Single filing-status checkbox (Checkbox_ReadOrder[0].c1_8[0])
//      was never checked.
//
// Loads the PDF, applies the patches in place, saves back. NO flatten:
// the golden has to remain AcroForm-readable so `readGoldenPdfValues`
// can introspect every widget at test time.
//
// Run: npx tsx scripts/patchAlexGolden.ts
//
// The script is dry-run by default — prints what it would change. Pass
// --apply to actually write the file.

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import {
  PDFCheckBox,
  PDFDocument,
  PDFTextField,
} from "pdf-lib";
import { projectRoot } from "../src/mastra/paths.js";

interface TextPatch {
  kind: "text";
  widgetName: string;
  newText: string;
  expectedOldText?: string;
}

interface CheckboxPatch {
  kind: "checkbox";
  widgetName: string;
  check: boolean;
  expectedOldChecked?: boolean;
}

type Patch = TextPatch | CheckboxPatch;

const GOLDEN_PATH = resolve(
  projectRoot,
  "tests/scenarios/alex/docs/Alex-1040-Golden.pdf",
);

const PATCHES: Patch[] = [
  // Round 1: missing commas on two W-2-withholding widgets.
  {
    kind: "text",
    widgetName: "topmostSubform[0].Page2[0].f2_17[0]",
    newText: "9,420",
    expectedOldText: "9420",
  },
  {
    kind: "text",
    widgetName: "topmostSubform[0].Page2[0].f2_29[0]",
    newText: "9,420",
    expectedOldText: "9420",
  },
  // Round 1: forgot to check the Single filing-status box.
  {
    kind: "checkbox",
    widgetName: "topmostSubform[0].Page1[0].Checkbox_ReadOrder[0].c1_8[0]",
    check: true,
    expectedOldChecked: false,
  },
  // Round 2: zero-value lines were left blank — the engine renders them
  // as "0", so the golden should too. (Lines 3a and 3b — dividends; line
  // 21 — add 19+20.)
  {
    kind: "text",
    widgetName: "topmostSubform[0].Page1[0].f1_60[0]",
    newText: "0",
    expectedOldText: "",
  },
  {
    kind: "text",
    widgetName: "topmostSubform[0].Page1[0].f1_61[0]",
    newText: "0",
    expectedOldText: "",
  },
  {
    kind: "text",
    widgetName: "topmostSubform[0].Page2[0].f2_13[0]",
    newText: "0",
    expectedOldText: "",
  },
  // Round 2: pass-through sums were left blank — line 18 = line 16 + 17
  // and line 22 = line 18 − 21. Both equal 8,835 for Alex.
  {
    kind: "text",
    widgetName: "topmostSubform[0].Page2[0].f2_10[0]",
    newText: "8,835",
    expectedOldText: "",
  },
  {
    kind: "text",
    widgetName: "topmostSubform[0].Page2[0].f2_14[0]",
    newText: "8,835",
    expectedOldText: "",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Loading: ${GOLDEN_PATH}`);
  console.log(`Mode: ${apply ? "APPLY (will overwrite)" : "DRY RUN (--apply to write)"}\n`);

  const bytes = await fs.readFile(GOLDEN_PATH);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();

  const allFields = form.getFields();
  const beforeWidgetCount = allFields.length;
  console.log(`Total form fields before patch: ${beforeWidgetCount}`);

  let appliedChanges = 0;
  let skippedNoChange = 0;
  let issues = 0;

  for (const patch of PATCHES) {
    let field;
    try {
      field = form.getField(patch.widgetName);
    } catch (err) {
      issues++;
      console.error(
        `✗ Widget not found: ${patch.widgetName}\n    ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    if (patch.kind === "text") {
      if (!(field instanceof PDFTextField)) {
        issues++;
        console.error(
          `✗ ${patch.widgetName}: expected PDFTextField, got ${field.constructor.name}`,
        );
        continue;
      }
      const current = field.getText() ?? "";
      // Idempotent: already-correct → no-op without complaint. Lets us
      // re-run the script after the file already absorbed Round 1.
      if (current === patch.newText) {
        skippedNoChange++;
        console.log(`= ${patch.widgetName}: already "${patch.newText}" — skipping`);
        continue;
      }
      if (
        patch.expectedOldText !== undefined &&
        current !== patch.expectedOldText
      ) {
        issues++;
        console.error(
          `✗ ${patch.widgetName}: expected current="${patch.expectedOldText}" but got "${current}". Aborting this patch to avoid clobbering unexpected content.`,
        );
        continue;
      }
      console.log(`✓ ${patch.widgetName}: text "${current}" → "${patch.newText}"`);
      field.setText(patch.newText);
      appliedChanges++;
    } else if (patch.kind === "checkbox") {
      if (!(field instanceof PDFCheckBox)) {
        issues++;
        console.error(
          `✗ ${patch.widgetName}: expected PDFCheckBox, got ${field.constructor.name}`,
        );
        continue;
      }
      let currentChecked = false;
      try {
        currentChecked = field.isChecked();
      } catch {
        // pdf-lib throws on unset checkboxes; treat as unchecked.
      }
      if (currentChecked === patch.check) {
        skippedNoChange++;
        console.log(`= ${patch.widgetName}: already ${patch.check ? "checked" : "unchecked"} — skipping`);
        continue;
      }
      if (
        patch.expectedOldChecked !== undefined &&
        currentChecked !== patch.expectedOldChecked
      ) {
        issues++;
        console.error(
          `✗ ${patch.widgetName}: expected checked=${patch.expectedOldChecked} but got ${currentChecked}. Aborting this patch.`,
        );
        continue;
      }
      console.log(
        `✓ ${patch.widgetName}: checkbox ${currentChecked} → ${patch.check}`,
      );
      if (patch.check) field.check();
      else field.uncheck();
      appliedChanges++;
    }
  }

  console.log("\nSummary:");
  console.log(`  changes:        ${appliedChanges}`);
  console.log(`  no-op skips:    ${skippedNoChange}`);
  console.log(`  issues:         ${issues}`);

  if (issues > 0) {
    console.error("\nIssues encountered — refusing to save.");
    process.exit(1);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with --apply to write.");
    return;
  }

  // Verify widget count unchanged before save.
  const afterWidgetCount = form.getFields().length;
  if (afterWidgetCount !== beforeWidgetCount) {
    console.error(
      `Widget count changed (${beforeWidgetCount} → ${afterWidgetCount}); refusing to save.`,
    );
    process.exit(1);
  }

  const saved = await pdf.save();
  await fs.writeFile(GOLDEN_PATH, saved);
  console.log(
    `\nWrote ${saved.length} bytes to ${GOLDEN_PATH}. Widget count preserved: ${afterWidgetCount}.`,
  );
}

main().catch((err) => {
  console.error("[patchAlexGolden] fatal:", err);
  process.exit(1);
});
