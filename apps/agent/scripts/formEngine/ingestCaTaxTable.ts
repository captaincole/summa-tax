// Ingest the California FTB Tax Table (2025 540 booklet appendix) from a
// cached PDF into a checked-in JSON file. Same shape as the federal
// ingest-federal-tax-table pipeline but reading from PDF text rather than
// HTML.
//
// `--refresh` re-downloads from ftb.ca.gov; default uses the cached PDF
// next to the JSON output.
//
// Spot-checks are hand-keyed from pages 1, 3, 4, and 5 of the published
// FTB table; any change to extraction logic must keep them passing.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  parseCATaxTable,
  validateCACoverage,
  type CATaxTableRow,
} from "../../src/forms-pipeline/tables/parseCATaxTable.js";
import { projectRoot } from "../../src/paths.js";
import type { Command } from "../lib/cli";

interface SpotCheck {
  taxableIncome: number;
  column: "single_or_mfs" | "mfj_or_qss" | "hoh";
  expectedTax: number;
}

interface CATaxTableSource {
  url: string;
  spotChecks: SpotCheck[];
}

const SOURCES: Record<number, CATaxTableSource> = {
  2025: {
    url: "https://www.ftb.ca.gov/forms/2025/2025-540-taxtable.pdf",
    spotChecks: [
      // Lowest band — should be $0 across all columns.
      { taxableIncome: 1, column: "single_or_mfs", expectedTax: 0 },
      { taxableIncome: 50, column: "hoh", expectedTax: 0 },
      // Early rows.
      { taxableIncome: 100, column: "single_or_mfs", expectedTax: 1 },
      { taxableIncome: 6500, column: "single_or_mfs", expectedTax: 65 },
      { taxableIncome: 6500, column: "mfj_or_qss", expectedTax: 65 },
      { taxableIncome: 6500, column: "hoh", expectedTax: 65 },
      // Mid range — single/MFS starts diverging from mfj/qss and hoh.
      { taxableIncome: 19500, column: "single_or_mfs", expectedTax: 279 },
      { taxableIncome: 19500, column: "mfj_or_qss", expectedTax: 195 },
      { taxableIncome: 19500, column: "hoh", expectedTax: 195 },
      { taxableIncome: 40500, column: "single_or_mfs", expectedTax: 984 },
      { taxableIncome: 40500, column: "mfj_or_qss", expectedTax: 588 },
      { taxableIncome: 40500, column: "hoh", expectedTax: 588 },
      // Alex's row — the golden 540 has line 31 = $3,256 at $73,294 single.
      { taxableIncome: 73294, column: "single_or_mfs", expectedTax: 3256 },
      { taxableIncome: 73294, column: "mfj_or_qss", expectedTax: 1660 },
      { taxableIncome: 73294, column: "hoh", expectedTax: 1771 },
      // Top of table.
      { taxableIncome: 99999, column: "single_or_mfs", expectedTax: 5736 },
      { taxableIncome: 99999, column: "mfj_or_qss", expectedTax: 3068 },
      { taxableIncome: 99999, column: "hoh", expectedTax: 3708 },
    ],
  },
};

const LOG = "[ingest-ca-tax-table]";

async function run(argv: string[]): Promise<void> {
  const args = parseCmdArgs(argv);
  const year = args.year;
  const source = SOURCES[year];
  if (!source) {
    throw new Error(
      `No source configured for CA tax year ${year}. Add an entry to SOURCES in this script.`,
    );
  }

  const dataDir = path.resolve(projectRoot, "src/mastra/forms/data");
  const pdfPath = path.join(dataDir, `ca-tax-table-${year}.source.pdf`);
  const jsonPath = path.join(dataDir, `ca-tax-table-${year}.json`);

  console.log(`${LOG} year=${year}`);
  console.log(`${LOG} source ${source.url}`);
  console.log(`${LOG} cache  ${path.relative(process.cwd(), pdfPath)}`);

  let pdfBytes: Buffer;
  let cached = true;
  if (args.refresh) {
    console.log(`${LOG} --refresh: fetching from ${source.url}`);
    const res = await fetch(source.url);
    if (!res.ok) {
      throw new Error(`FTB fetch failed: ${res.status} ${res.statusText}`);
    }
    pdfBytes = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(pdfPath, pdfBytes);
    cached = false;
  } else {
    pdfBytes = await fs.readFile(pdfPath);
  }
  const sha256 = await sha256Hex(pdfBytes);
  console.log(
    `${LOG} pdf ${cached ? "from cache" : "fetched"} ` +
      `(${(pdfBytes.length / 1024).toFixed(1)}KB, sha256 ${sha256.slice(0, 12)}…)`,
  );

  const { rows, diagnostics } = await parseCATaxTable(new Uint8Array(pdfBytes));
  console.log(
    `${LOG} parsed ${rows.length} rows ` +
      `(accepted ${diagnostics.linesAccepted}/${diagnostics.linesInspected} lines, ` +
      `rejected ${diagnostics.linesRejected})`,
  );

  const coverage = validateCACoverage(rows);
  console.log(
    `${LOG} coverage [${coverage.minIncome}, ${coverage.maxIncome}] ` +
      `(${coverage.rowCount} rows, gaps=${coverage.gaps.length}, overlaps=${coverage.overlaps.length})`,
  );
  if (!coverage.ok) {
    if (coverage.gaps.length > 0) {
      console.error(`${LOG} gaps:`, coverage.gaps.slice(0, 5));
    }
    if (coverage.overlaps.length > 0) {
      console.error(`${LOG} overlaps:`, coverage.overlaps.slice(0, 5));
    }
    throw new Error("Coverage validation failed; refusing to write JSON.");
  }

  const spotResults = source.spotChecks.map((sc) => {
    const row = rows.find(
      (r) => sc.taxableIncome >= r.low && sc.taxableIncome <= r.high,
    );
    const got = row ? row[sc.column] : null;
    return { ...sc, got, pass: got === sc.expectedTax };
  });
  const failed = spotResults.filter((r) => !r.pass);
  console.log(
    `${LOG} spot checks ${spotResults.length - failed.length}/${spotResults.length} pass`,
  );
  for (const f of failed) {
    console.error(
      `  ✗ income=${f.taxableIncome} column=${f.column} expected=${f.expectedTax} got=${f.got}`,
    );
  }
  if (failed.length > 0) {
    throw new Error("Spot-check failures; refusing to write JSON.");
  }

  const header = {
    tableId: `ca-${year}`,
    taxYear: year,
    jurisdiction: "state-ca",
    source: {
      url: source.url,
      fetchedAt: new Date().toISOString(),
      sha256,
      cacheFile: `ca-tax-table-${year}.source.pdf`,
    },
    coverage: {
      minIncome: coverage.minIncome,
      maxIncome: coverage.maxIncome,
      rowCount: coverage.rowCount,
    },
    boundaryConvention: "inclusive",
    filingStatusColumns: {
      single: "single_or_mfs",
      married_filing_separately: "single_or_mfs",
      married_filing_jointly: "mfj_or_qss",
      qualifying_surviving_spouse: "mfj_or_qss",
      head_of_household: "hoh",
    },
  };
  await fs.writeFile(jsonPath, serializeWithCompactRows(header, rows), "utf8");
  console.log(`${LOG} wrote ${path.relative(process.cwd(), jsonPath)}`);
}

function serializeWithCompactRows(
  header: Record<string, unknown>,
  rows: CATaxTableRow[],
): string {
  const headerJson = JSON.stringify(header, null, 2);
  const headerOpen = headerJson.slice(0, headerJson.lastIndexOf("}"));
  const rowLines = rows
    .map(
      (r) =>
        `    {"low":${r.low},"high":${r.high},"single_or_mfs":${r.single_or_mfs},"mfj_or_qss":${r.mfj_or_qss},"hoh":${r.hoh}}`,
    )
    .join(",\n");
  return `${headerOpen.trimEnd()},\n  "rows": [\n${rowLines}\n  ]\n}\n`;
}

async function sha256Hex(bytes: Buffer): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

function parseCmdArgs(argv: string[]): { year: number; refresh: boolean } {
  let year = 2025;
  let refresh = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--year") {
      const v = argv[++i];
      if (!v || Number.isNaN(Number(v))) throw new Error(`--year requires a number`);
      year = Number(v);
    } else if (a === "--refresh") {
      refresh = true;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { year, refresh };
}

export const ingestCaTaxTableCommand: Command = {
  name: "ingest-ca-tax-table",
  summary: "CA FTB 540 tax table (PDF) → checked-in JSON, with spot-checks",
  options: [
    { flag: "--year <year>", desc: "tax year with a SOURCES entry (default: 2025)" },
    { flag: "--refresh", desc: "re-download from ftb.ca.gov instead of the cached PDF" },
  ],
  run,
};
