// Print recent ai_decisions rows with their verdicts and citations. Useful
// to confirm Nynaeve's grounding actually landed in the DB after running
// smoke:review or talking to Thom.
//
// Usage:
//   npx tsx scripts/inspectDecisions.ts                       # 5 most recent
//   npx tsx scripts/inspectDecisions.ts --limit 20
//   npx tsx scripts/inspectDecisions.ts --taxpayer demo-session
//   npx tsx scripts/inspectDecisions.ts --decision-key decisions.filing_status_eligibility
import "dotenv/config";
import { parseArgs } from "node:util";
import { createClient } from "@libsql/client";

async function main() {
  const { values } = parseArgs({
    options: {
      limit: { type: "string", default: "5" },
      taxpayer: { type: "string" },
      "decision-key": { type: "string" },
    },
  });
  const limit = Math.max(1, Math.min(Number(values.limit), 100));

  const where: string[] = [];
  const args: (string | number)[] = [];
  if (values.taxpayer) {
    where.push("taxpayer_id = ?");
    args.push(values.taxpayer);
  }
  if (values["decision-key"]) {
    where.push("decision_key = ?");
    args.push(values["decision-key"]);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const c = createClient({
    url: process.env.DATABASE_URL ?? "file:./wheel-of-time.db",
  });

  const r = await c.execute({
    sql: `SELECT id, taxpayer_id, decision_key, decision_json, rationale,
                 supporting_fact_keys_json, confidence,
                 verdict, verdict_reason, authority_citations_json,
                 created_at, verdict_at
          FROM ai_decisions
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT ?`,
    args: [...args, limit],
  });

  if (r.rows.length === 0) {
    console.log("(no decisions match)");
    return;
  }

  for (const row of r.rows) {
    const created = new Date(Number(row.created_at)).toISOString();
    const reviewed = row.verdict_at
      ? new Date(Number(row.verdict_at)).toISOString()
      : "(not reviewed)";
    const decision = JSON.parse(String(row.decision_json));
    const factKeys = JSON.parse(String(row.supporting_fact_keys_json));
    const citations = row.authority_citations_json
      ? (JSON.parse(String(row.authority_citations_json)) as {
          blockId: string;
          quote?: string;
        }[])
      : [];

    const verdictTag = (() => {
      switch (row.verdict) {
        case "accurate": return "✓ accurate";
        case "inaccurate": return "✗ inaccurate";
        case "ungroundable": return "? ungroundable";
        case "review_failed": return "! review_failed";
        default: return "(no verdict)";
      }
    })();

    console.log("=".repeat(70));
    console.log(`${verdictTag}  ${row.decision_key}`);
    console.log(`  taxpayer: ${row.taxpayer_id}`);
    console.log(`  decision: ${JSON.stringify(decision)}`);
    console.log(`  facts:    ${factKeys.join(", ") || "(none)"}`);
    console.log(`  conf:     ${row.confidence}`);
    console.log(`  recorded: ${created}`);
    console.log(`  reviewed: ${reviewed}`);
    console.log(`  rationale: ${String(row.rationale).slice(0, 200)}${String(row.rationale).length > 200 ? "…" : ""}`);
    if (row.verdict_reason) {
      console.log(`  verdict_reason: ${String(row.verdict_reason).slice(0, 240)}${String(row.verdict_reason).length > 240 ? "…" : ""}`);
    }
    if (citations.length > 0) {
      console.log(`  citations:`);
      for (const cit of citations) {
        console.log(`    - ${cit.blockId}${cit.quote ? `  "${cit.quote.slice(0, 80)}…"` : ""}`);
      }
    }
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
