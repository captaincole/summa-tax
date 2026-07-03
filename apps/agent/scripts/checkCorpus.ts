import "dotenv/config";
import { listDocuments, tableCounts, countBlocksByDoc } from "../src/mastra/db/refDocs";

async function main() {
  const counts = await tableCounts();
  for (const [t, n] of Object.entries(counts)) {
    console.log(`${t}: count=${n}`);
  }
  // Per-doc breakdown.
  for (const d of await listDocuments()) {
    const { blocks, embedded } = await countBlocksByDoc(d.docId);
    console.log(`  ${d.docId}: blocks=${blocks}, embedded=${embedded}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
