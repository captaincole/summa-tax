/**
 * End-to-end test: insert Alex's facts into the DB, call
 * generate-draft-1040, render the result to PNG, and print the paths.
 *
 * If the DB has residue, hit "Reset session" in the web app first (or run
 * TRUNCATE in the Supabase SQL editor).
 *   npx tsx scripts/testDraft1040.ts
 */
import "dotenv/config";
import { recordFact } from "../src/mastra/db/taxFacts";
import { generateDraft1040 } from "../src/mastra/tools/generateDraft1040";
import { execSync } from "node:child_process";

const TAXPAYER_ID = "test-alex";
const YEAR = 2025;

const alexFacts: { category: string; key: string; value: unknown }[] = [
  { category: "preferences", key: "preferences.knowledge_level", value: "beginner" },
  { category: "preferences", key: "preferences.detail_mode", value: "easy" },
  { category: "identity", key: "tax_year", value: 2025 },
  { category: "identity", key: "identity.name.first", value: "Alex" },
  { category: "identity", key: "identity.name.last", value: "Morales" },
  { category: "identity", key: "identity.ssn", value: "123-45-6789" },
  { category: "identity", key: "identity.address.street", value: "2245 Lakeshore Ave" },
  { category: "identity", key: "identity.address.apt", value: "Apt 3" },
  { category: "identity", key: "identity.address.city", value: "Oakland" },
  { category: "identity", key: "identity.address.state", value: "CA" },
  { category: "identity", key: "identity.address.zip", value: "94606" },
  { category: "filing_status", key: "identity.filing_status", value: "single" },
  { category: "dependents", key: "identity.dependents_count", value: 0 },
  { category: "state_local_tax", key: "residency.state", value: "CA" },
  { category: "identity", key: "residency.full_year_in_state", value: true },

  // Scoping facts (all "no" for Alex's shape)
  { category: "mortgage", key: "mortgage.owns_home", value: false },
  { category: "investment_income", key: "investment_income.has_accounts", value: false },
  { category: "hsa", key: "hsa.has_account", value: false },
  { category: "self_employment", key: "self_employment.has_income", value: false },
  { category: "k1", key: "k1.has_k1", value: false },
  { category: "rental", key: "rental.has_rental", value: false },
  { category: "foreign", key: "foreign.has_accounts", value: false },
  { category: "crypto", key: "crypto.has_activity", value: false },
  { category: "charitable", key: "charitable.has_giving", value: false },

  // W-2 facts
  { category: "wages", key: "wages.has_w2_income", value: true },
  { category: "wages", key: "wages.w2_count", value: 1 },
  { category: "wages", key: "w2.employer.name", value: "Brightside Logistics, Inc." },
  { category: "wages", key: "w2.employer.ein", value: "36-1234567" },
  { category: "wages", key: "w2.box1", value: 79000 },
  { category: "wages", key: "w2.box2", value: 9420 },
  { category: "wages", key: "w2.box3", value: 85000 },
  { category: "wages", key: "w2.box4", value: 5270 },
  { category: "wages", key: "w2.box5", value: 85000 },
  { category: "wages", key: "w2.box6", value: 1232.5 },
  { category: "wages", key: "w2.box12_codes", value: ["D"] },
  { category: "wages", key: "w2.box13.retirement_plan", value: true },
  { category: "state_local_tax", key: "w2.box14.ca_sdi", value: 935 },
  { category: "state_local_tax", key: "w2.box15", value: "CA" },
  { category: "state_local_tax", key: "w2.box16", value: 79000 },
  { category: "state_local_tax", key: "w2.box17", value: 3100 },
  { category: "retirement", key: "retirement.contribution_401k", value: 6000 },
];

async function main() {
  console.log(`Seeding ${alexFacts.length} facts for ${TAXPAYER_ID}…`);
  for (const f of alexFacts) {
    await recordFact({
      id: crypto.randomUUID(),
      taxpayerId: TAXPAYER_ID,
      year: YEAR,
      category: f.category,
      key: f.key,
      value: f.value,
      sourceNote: "test seeded by scripts/testDraft1040.ts",
    });
  }

  console.log("Generating draft 1040…");
  const result = await (generateDraft1040 as any).execute({
    taxpayerId: TAXPAYER_ID,
    year: YEAR,
  });
  console.log(`Wrote PDF: ${result.path}`);
  console.log(`Served at: http://localhost:4111${result.url}`);
  console.log(`Lines populated: ${result.linesPopulated}`);

  // Render to PNGs for visual verification.
  try {
    execSync(`pdftoppm -png -r 150 "${result.path}" /tmp/test-draft-1040`, {
      stdio: "inherit",
    });
    console.log("Rendered: /tmp/test-draft-1040-1.png, -2.png");
  } catch (err) {
    console.error("pdftoppm failed (install poppler?):", err);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
