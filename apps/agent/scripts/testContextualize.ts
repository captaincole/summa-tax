// One-shot sanity check for the contextualization pipeline. Picks a known
// block (the "never married" one in § Single) and runs a single Haiku call
// to verify the API + prompt produce a reasonable summary before we burn
// tokens on the full ~250-block ingest.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { summarizeBlock } from "../src/refdocs/contextualize";

async function main() {
  const docText = await readFile(
    "forms/federal/1040/instructions.canonical.txt",
    "utf8",
  );
  // The "Single" filing-status section starts at line 982 in the canonical
  // text — find it and use that as our section text.
  const singleStart = docText.indexOf("\nSingle\nYou can check");
  const singleEnd = docText.indexOf("\nMarried Filing Jointly\n", singleStart);
  const sectionText = docText.slice(singleStart + 1, singleEnd).trim();

  const blockText =
    `You can check the "Single" box in the Filing Status section on page 1 of Form 1040 or 1040-SR if any of the following was true on December 31, 2025.\n` +
    `• You were never married.\n` +
    `• You were legally separated according to your state law under a decree of divorce or separate maintenance.`;

  console.log(`section length: ${sectionText.length} chars`);
  console.log(`block length: ${blockText.length} chars\n`);

  const t0 = Date.now();
  const summary = await summarizeBlock({
    documentTitle: "Instructions for Form 1040 (2025)",
    sectionHeading: "Single",
    sectionText,
    blockText,
  });
  const elapsed = Date.now() - t0;
  console.log(`summary (${elapsed}ms):`);
  console.log(`  ${summary}`);
  console.log(`\ncontextualized text would be:`);
  console.log(`---`);
  console.log(`${summary}\n\n${blockText}`);
  console.log(`---`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
