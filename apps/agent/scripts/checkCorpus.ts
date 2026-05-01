import "dotenv/config";
import { getServiceRoleClient } from "../src/mastra/db/supabase";

async function main() {
  const sb = getServiceRoleClient();
  const tables = ["ref_documents", "ref_pages", "ref_sections", "ref_blocks"];
  for (const t of tables) {
    const { count, error } = await sb
      .from(t)
      .select("*", { count: "exact", head: true });
    console.log(
      `${t}: count=${count ?? "?"}, error=${error ? JSON.stringify(error) : "ok"}`,
    );
  }
  // Per-doc breakdown.
  const { data: docs } = await sb.from("ref_documents").select("doc_id, sha256");
  for (const d of docs ?? []) {
    const { count: blockCount } = await sb
      .from("ref_blocks")
      .select("*", { count: "exact", head: true })
      .eq("doc_id", d.doc_id);
    const { count: embeddedCount } = await sb
      .from("ref_blocks")
      .select("*", { count: "exact", head: true })
      .eq("doc_id", d.doc_id)
      .not("embedding", "is", null);
    console.log(
      `  ${d.doc_id}: blocks=${blockCount ?? "?"}, embedded=${embeddedCount ?? "?"}`,
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
