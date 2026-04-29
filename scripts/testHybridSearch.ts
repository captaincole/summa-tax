import "dotenv/config";
import { hybridSearchRefDocs } from "../src/mastra/db/refDocs";

async function main() {
  const queries = [
    "filing status eligibility",
    "single filer never married",
    "household employee wages",
    "qualified dividends",
    "medicaid waiver payments",
    "earned income credit qualifying child",
  ];
  for (const q of queries) {
    console.log(`\n=== hybrid+rerank: "${q}" ===`);
    const r = await hybridSearchRefDocs({ query: q, limit: 3 });
    r.forEach((h, i) =>
      console.log(
        `  ${i + 1}. p${h.pageNum} § ${h.sectionHeading ?? "(none)"} (score ${h.score.toFixed(3)})`,
      ),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
