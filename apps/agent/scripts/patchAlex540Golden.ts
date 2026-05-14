// One-off patch for tests/scenarios/alex/docs/Alex-CA540-Golden.pdf.
//
// Three rounds of fixes, each derived from a class of golden-vs-rendered
// mismatch the offline integration test surfaced once the new typed
// bindings landed:
//
//   1. Money widgets — golden was filled without comma grouping. Renderer
//      writes "79,000" etc.; golden originally had "79000". Patch golden
//      to match our (CPA-conventional) comma format.
//   2. Blank-on-zero widgets — golden left lines whose computed value is 0
//      empty; our renderer writes "0" explicitly. Patch golden to write
//      "0" so both sides agree on the zero convention (consistent with how
//      we fixed the 1040 golden).
//   3. Phone widget — golden had "4152634587" left over from a different
//      test scenario; should be Alex's actual phone "7039530253".
//
// Like patchAlexGolden.ts, this script is dry-run by default. Pass
// --apply to actually overwrite the PDF. NO flatten — golden has to stay
// AcroForm-readable for `readGoldenPdfValues`.
//
// Run: npx tsx scripts/patchAlex540Golden.ts [--apply]

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, PDFTextField } from "pdf-lib";
import { projectRoot } from "../src/mastra/paths.js";

interface TextPatch {
  widgetName: string;
  newText: string;
  expectedOldText?: string;
}

const GOLDEN_PATH = resolve(
  projectRoot,
  "tests/scenarios/alex/docs/Alex-CA540-Golden.pdf",
);

const PATCHES: TextPatch[] = [
  // ─── Round 1: money widgets, add comma grouping ────────────────────
  { widgetName: "540_form_2018", newText: "79,000", expectedOldText: "79000" },
  { widgetName: "540_form_2019", newText: "79,000", expectedOldText: "79000" },
  { widgetName: "540_form_2021", newText: "79,000", expectedOldText: "79000" },
  { widgetName: "540_form_2023", newText: "79,000", expectedOldText: "79000" },
  { widgetName: "540_form_2024", newText: "5,706", expectedOldText: "5706" },
  { widgetName: "540_form_2025", newText: "73,294", expectedOldText: "73294" },
  { widgetName: "540_form_2030", newText: "3,256", expectedOldText: "3256" },
  { widgetName: "540_form_2032", newText: "3,103", expectedOldText: "3103" },
  { widgetName: "540_form_2036", newText: "3,103", expectedOldText: "3103" },
  { widgetName: "540_form_3006", newText: "3,103", expectedOldText: "3103" },
  { widgetName: "540_form_3010", newText: "3,103", expectedOldText: "3103" },
  { widgetName: "540_form_3011", newText: "3,100", expectedOldText: "3100" },
  { widgetName: "540_form_3018", newText: "3,100", expectedOldText: "3100" },
  { widgetName: "540_form_3023", newText: "3,100", expectedOldText: "3100" },
  { widgetName: "540_form_3025", newText: "3,100", expectedOldText: "3100" },

  // ─── Round 2: blank-on-zero widgets, write "0" explicitly ───────────
  { widgetName: "540_form_2020", newText: "0", expectedOldText: "" },
  { widgetName: "540_form_2022", newText: "0", expectedOldText: "" },
  { widgetName: "540_form_3005", newText: "0", expectedOldText: "" },
  { widgetName: "540_form_3024", newText: "0", expectedOldText: "" },
  { widgetName: "540_form_3026", newText: "0", expectedOldText: "" },
  { widgetName: "540_form_3027", newText: "0", expectedOldText: "" },
  { widgetName: "540_form_4004", newText: "0", expectedOldText: "" },
  { widgetName: "540_form_4024", newText: "0", expectedOldText: "" },
  // 5006 is line 100 (tax due = $3) — engine output is correct;
  // golden was empty. Write the real value.
  { widgetName: "540_form_5006", newText: "3", expectedOldText: "" },
  { widgetName: "540_form_5007", newText: "0", expectedOldText: "" },

  // ─── Round 3: phone number from old scenario ────────────────────────
  {
    widgetName: "540_form_6003",
    newText: "7039530253",
    expectedOldText: "4152634587",
  },

  // ─── Round 4: page-2 SSN typo. Whoever filled the golden typed
  // "12-345-6789" (2-3-4 digit split) instead of the standard
  // "123-45-6789" (3-2-4). Renderer emits the canonical dashed form via
  // the page2.taxpayer_ssn formatter override.
  {
    widgetName: "540_form_2002",
    newText: "123-45-6789",
    expectedOldText: "12-345-6789",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Loading: ${GOLDEN_PATH}`);
  console.log(
    `Mode: ${apply ? "APPLY (will overwrite)" : "DRY RUN (--apply to write)"}\n`,
  );

  const bytes = await fs.readFile(GOLDEN_PATH);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const form = pdf.getForm();
  const beforeCount = form.getFields().length;
  console.log(`Total form fields before patch: ${beforeCount}`);

  let applied = 0;
  let skipped = 0;
  let issues = 0;
  for (const patch of PATCHES) {
    let field;
    try {
      field = form.getField(patch.widgetName);
    } catch (err) {
      issues++;
      console.error(
        `✗ Widget not found: ${patch.widgetName} — ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    if (!(field instanceof PDFTextField)) {
      issues++;
      console.error(
        `✗ ${patch.widgetName}: expected PDFTextField, got ${field.constructor.name}`,
      );
      continue;
    }
    const current = field.getText() ?? "";
    // Idempotent: already-correct = no-op (lets us re-run after partial apply).
    if (current === patch.newText) {
      skipped++;
      console.log(`= ${patch.widgetName}: already "${patch.newText}" — skipping`);
      continue;
    }
    if (
      patch.expectedOldText !== undefined &&
      current !== patch.expectedOldText
    ) {
      issues++;
      console.error(
        `✗ ${patch.widgetName}: expected current="${patch.expectedOldText}" but got "${current}". Aborting this patch to avoid clobbering.`,
      );
      continue;
    }
    console.log(`✓ ${patch.widgetName}: "${current}" → "${patch.newText}"`);
    field.setText(patch.newText);
    applied++;
  }

  console.log("\nSummary:");
  console.log(`  changes:        ${applied}`);
  console.log(`  no-op skips:    ${skipped}`);
  console.log(`  issues:         ${issues}`);

  if (issues > 0) {
    console.error("\nIssues encountered — refusing to save.");
    process.exit(1);
  }
  if (!apply) {
    console.log("\nDry run complete. Re-run with --apply to write.");
    return;
  }
  const afterCount = form.getFields().length;
  if (afterCount !== beforeCount) {
    console.error(
      `Widget count changed (${beforeCount} → ${afterCount}); refusing to save.`,
    );
    process.exit(1);
  }
  const saved = await pdf.save();
  await fs.writeFile(GOLDEN_PATH, saved);
  console.log(
    `\nWrote ${saved.length} bytes to ${GOLDEN_PATH}. Widget count preserved: ${afterCount}.`,
  );
}

main().catch((err) => {
  console.error("[patchAlex540Golden] fatal:", err);
  process.exit(1);
});
