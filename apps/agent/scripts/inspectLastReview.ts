/**
 * One-off: dump the most recent review-decision workflow run, including each
 * step's input/output JSON and the matching Mastra trace span. Useful when
 * Studio's logs view is broken and we need to see what actually happened.
 *
 * Usage:
 *   npx tsx --env-file=.env.development scripts/inspectLastReview.ts
 */
import "dotenv/config";
import { Pool } from "pg";

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

async function main() {
  if (!process.env.POSTGRES_URL) {
    console.error("POSTGRES_URL is required");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const decision = await pool.query<{
      id: string;
      decision_key: string;
      decision: unknown;
      verdict: string | null;
      verdict_reason: string | null;
      latest_review_run_id: string | null;
      created_at: string;
    }>(`
      SELECT id, decision_key, decision, verdict, verdict_reason, latest_review_run_id, created_at
      FROM public.ai_decisions
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
    console.log(`decision:             ${JSON.stringify(d.decision)}`);
    console.log(`verdict:              ${d.verdict ?? "(null)"}`);
    console.log(`verdict_reason:       ${d.verdict_reason ?? "(null)"}`);
    console.log(`latest_review_run_id: ${d.latest_review_run_id ?? "(null)"}`);
    console.log(`created_at:           ${d.created_at}`);

    if (!d.latest_review_run_id) {
      console.log("\n(no associated review_run — workflow likely never started)");
      return;
    }

    const run = await pool.query<{
      id: string;
      status: string;
      final_verdict: string | null;
      iteration_count: number | null;
      duration_ms: number | null;
      error: string | null;
      started_at: string;
      completed_at: string | null;
    }>(
      `SELECT id, status, final_verdict, iteration_count, duration_ms, error, started_at, completed_at
       FROM public.review_runs WHERE id = $1`,
      [d.latest_review_run_id],
    );
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

    const steps = await pool.query<{
      step_kind: string;
      iteration: number;
      duration_ms: number;
      input_json: unknown;
      output_json: unknown;
      created_at: string;
    }>(
      `SELECT step_kind, iteration, duration_ms, input_json, output_json, created_at
       FROM public.review_run_steps WHERE run_id = $1
       ORDER BY created_at ASC`,
      [r.id],
    );
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`review_run_steps (${steps.rows.length} total)`);
    console.log("════════════════════════════════════════════════════════════");
    for (const s of steps.rows) {
      console.log(
        `\n── step: ${s.step_kind} · iter ${s.iteration} · ${s.duration_ms}ms · ${s.created_at}`,
      );
      pp("  input", s.input_json);
      pp("  output", s.output_json);
    }

    const traces = await pool.query<{
      name: string;
      attributes: unknown;
      events: unknown;
      status: unknown;
      startTime: string;
      endTime: string | null;
    }>(
      `SELECT name, attributes, events, status, "startTime", "endTime"
       FROM mastra.mastra_traces
       WHERE name ILIKE '%review-decision%'
       ORDER BY "startTime" DESC
       LIMIT 10`,
    );
    console.log("\n════════════════════════════════════════════════════════════");
    console.log(`mastra_traces (latest 10 review-decision spans)`);
    console.log("════════════════════════════════════════════════════════════");
    for (const t of traces.rows) {
      console.log(
        `\n── ${t.name} · ${t.startTime} → ${t.endTime ?? "(open)"}`,
      );
      pp("  status", t.status);
      pp("  attributes", t.attributes);
      pp("  events", t.events);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("inspect failed:", err);
  process.exit(1);
});
