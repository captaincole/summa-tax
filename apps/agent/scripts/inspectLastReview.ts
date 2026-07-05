/**
 * One-off: dump the most recent review-decision workflow run, including each
 * step's input/output JSON. Useful when Studio's logs view is broken and we
 * need to see what actually happened.
 *
 * Reads the libsql app DB (ai_decisions / review_runs / review_run_steps).
 * The old mastra_traces dump is gone — traces live in the in-memory
 * observability store now, visible only in Studio while the dev server runs.
 *
 * Usage:
 *   npx tsx --env-file=.env.development scripts/inspectLastReview.ts
 */
import "dotenv/config";
import { getAppDb, ensureAppSchema } from "../src/mastra/db/appDb";

const TRUNCATE_AT = 1500;

function pp(label: string, value: unknown) {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (s == null) return console.log(`${label}: (null)`);
  if (s.length > TRUNCATE_AT) {
    console.log(`${label}:\n${s.slice(0, TRUNCATE_AT)}\n  …[truncated ${s.length - TRUNCATE_AT} chars]`);
  } else {
    console.log(`${label}:\n${s}`);
  }
}

const parse = (v: unknown): unknown => (v == null ? null : JSON.parse(String(v)));

async function main() {
  await ensureAppSchema();
  const db = getAppDb();

  const decision = await db.execute(`
    SELECT id, decision_key, decision, verdict, verdict_reason, latest_review_run_id, created_at
    FROM ai_decisions
    ORDER BY created_at DESC
    LIMIT 1
  `);
  if (decision.rows.length === 0) {
    console.log("(no ai_decisions rows yet)");
    return;
  }
  const d = decision.rows[0];
  console.log("════════════════════════════════════════════════════════════");
  console.log("MOST RECENT ai_decision");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`id:                   ${d.id}`);
  console.log(`decisionKey:          ${d.decision_key}`);
  console.log(`decision:             ${JSON.stringify(parse(d.decision))}`);
  console.log(`verdict:              ${d.verdict ?? "(null)"}`);
  console.log(`verdict_reason:       ${d.verdict_reason ?? "(null)"}`);
  console.log(`latest_review_run_id: ${d.latest_review_run_id ?? "(null)"}`);
  console.log(`created_at:           ${d.created_at}`);

  if (!d.latest_review_run_id) {
    console.log("\n(no associated review_run — workflow likely never started)");
    return;
  }

  const run = await db.execute({
    sql: `SELECT id, status, final_verdict, iteration_count, duration_ms, error, started_at, completed_at
          FROM review_runs WHERE id = ?`,
    args: [String(d.latest_review_run_id)],
  });
  if (run.rows.length === 0) {
    console.log("\n(latest_review_run_id points to a missing review_runs row)");
    return;
  }
  const r = run.rows[0];
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("review_run");
  console.log("════════════════════════════════════════════════════════════");
  console.log(`id:              ${r.id}`);
  console.log(`status:          ${r.status}`);
  console.log(`final_verdict:   ${r.final_verdict ?? "(null)"}`);
  console.log(`iteration_count: ${r.iteration_count ?? "(null)"}`);
  console.log(`duration_ms:     ${r.duration_ms ?? "(null)"}`);
  console.log(`error:           ${r.error ?? "(null)"}`);
  console.log(`started_at:      ${r.started_at}`);
  console.log(`completed_at:    ${r.completed_at ?? "(null)"}`);

  const steps = await db.execute({
    sql: `SELECT step_kind, iteration, duration_ms, input_json, output_json, created_at
          FROM review_run_steps WHERE run_id = ?
          ORDER BY created_at ASC`,
    args: [String(r.id)],
  });
  console.log("\n════════════════════════════════════════════════════════════");
  console.log(`review_run_steps (${steps.rows.length} total)`);
  console.log("════════════════════════════════════════════════════════════");
  for (const s of steps.rows) {
    console.log(
      `\n── step: ${s.step_kind} · iter ${s.iteration} · ${s.duration_ms}ms · ${s.created_at}`,
    );
    pp("  input", parse(s.input_json));
    pp("  output", parse(s.output_json));
  }
}

main().catch((err) => {
  console.error("inspect failed:", err);
  process.exit(1);
});
