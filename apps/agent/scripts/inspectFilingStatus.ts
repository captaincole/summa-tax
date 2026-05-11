/**
 * Print the FilingStatus categorization tree for a user.
 *
 * Loads facts + decisions, runs the form engine, rolls up by category, and
 * prints each category's progress + per-item state. Useful for verifying the
 * categorization layer after a wipe + re-ingest cycle.
 *
 * Usage:
 *   npx tsx --env-file=.env.development scripts/inspectFilingStatus.ts <userId> [year]
 *
 * If userId is omitted, picks the most recent fact-writer in the database.
 */
import "dotenv/config";
import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  makeDecisionsView,
  makeFactsView,
  type DerivationContext,
} from "../src/mastra/forms/types.js";
import { evaluateForm8949 } from "../src/mastra/forms/form8949.js";
import { evaluateScheduleD } from "../src/mastra/forms/scheduleD.js";
import { evaluateForm1040 } from "../src/mastra/forms/form1040.js";
import { evaluateForm540 } from "../src/mastra/forms/form540.js";
import {
  categorizeFormProgress,
  type FilingStatus,
} from "../src/mastra/forms/categorization/categorize.js";
import type { TaxFactRow } from "../src/mastra/db/taxFacts.js";
import type { AIDecisionRow } from "../src/mastra/db/aiDecisions.js";

async function pickRecentUser(pool: Pool): Promise<string | null> {
  const r = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM public.tax_facts
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  return r.rows[0]?.user_id ?? null;
}

function fmtBar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

function printFilingStatus(fs: FilingStatus) {
  console.log("════════════════════════════════════════════════════════════");
  console.log(`Overall progress: ${fmtBar(fs.overallPct)} ${fs.overallPct}%`);
  console.log("════════════════════════════════════════════════════════════");
  for (const c of fs.categories) {
    const pct = c.total === 0 ? 0 : Math.round((c.completed / c.total) * 100);
    console.log(
      `\n${c.label.padEnd(22)} ${fmtBar(pct)} ${pct.toString().padStart(3)}%   ${c.completed}/${c.total}`,
    );
    if (c.items.length === 0) {
      console.log("  (no items)");
      continue;
    }
    for (const item of c.items) {
      const tick = item.state === "complete" ? "✓" : "·";
      const label = item.label.length > 60 ? item.label.slice(0, 57) + "…" : item.label;
      console.log(`  ${tick} ${label.padEnd(62)} ${item.id}`);
      if (item.state === "pending" && item.reason) {
        console.log(`      ↳ ${item.reason}`);
      }
    }
  }
}

async function main() {
  if (!process.env.POSTGRES_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
    console.error("POSTGRES_URL, SUPABASE_URL, and SUPABASE_SECRET_KEY are required");
    process.exit(1);
  }

  const userArg = process.argv[2];
  const yearArg = Number(process.argv[3] ?? 2025);

  const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
  try {
    const userId = userArg ?? (await pickRecentUser(pool));
    if (!userId) {
      console.error("No user id provided and no facts found. Run an ingest first.");
      process.exit(1);
    }

    // Service-role client — bypasses RLS so the script can read any user's
    // domain rows. Same pattern as the corpus ingest scripts.
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false } },
    );

    const [factsRes, decisionsRes] = await Promise.all([
      supabase
        .from("tax_facts")
        .select("*")
        .eq("user_id", userId)
        .eq("tax_year", yearArg)
        .order("created_at", { ascending: false })
        .limit(500),
      supabase
        .from("ai_decisions")
        .select("*")
        .eq("user_id", userId)
        .eq("tax_year", yearArg)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    if (factsRes.error) throw new Error(factsRes.error.message);
    if (decisionsRes.error) throw new Error(decisionsRes.error.message);

    // Collapse to latest-per-key (tax_facts and ai_decisions are append-only;
    // the form engine takes the most recent value per key).
    const facts: TaxFactRow[] = [];
    const seenFactKeys = new Set<string>();
    for (const row of (factsRes.data ?? []) as Array<Record<string, unknown>>) {
      const key = row.fact_key as string;
      if (seenFactKeys.has(key)) continue;
      seenFactKeys.add(key);
      facts.push({
        id: row.id as string,
        userId: row.user_id as string,
        taxYear: row.tax_year as number,
        category: row.category as string,
        key,
        value: row.fact_value,
        sourceNote: (row.source_note as string | null) ?? null,
        createdAt: row.created_at as string,
      });
    }

    const decisions: AIDecisionRow[] = [];
    const seenDecisionKeys = new Set<string>();
    for (const row of (decisionsRes.data ?? []) as Array<Record<string, unknown>>) {
      const key = row.decision_key as string;
      if (seenDecisionKeys.has(key)) continue;
      seenDecisionKeys.add(key);
      decisions.push({
        id: row.id as string,
        userId: row.user_id as string,
        taxYear: row.tax_year as number,
        decisionKey: key,
        decision: row.decision,
        rationale: row.rationale as string,
        supportingFactKeys: row.supporting_fact_keys as string[],
        confidence: row.confidence as AIDecisionRow["confidence"],
        dissentingConsiderations: (row.dissenting_considerations as string | null) ?? null,
        authorityCitations: row.authority_citations ?? null,
        sourceNote: (row.source_note as string | null) ?? null,
        createdAt: row.created_at as string,
        verdict: (row.verdict as AIDecisionRow["verdict"]) ?? null,
        verdictReason: (row.verdict_reason as string | null) ?? null,
        verdictAt: (row.verdict_at as string | null) ?? null,
      });
    }

    const ctx: DerivationContext = {
      taxYear: yearArg,
      facts: makeFactsView(facts),
      decisions: makeDecisionsView(decisions),
    };

    const form8949 = evaluateForm8949(ctx);
    const scheduleD = evaluateScheduleD(ctx, form8949);
    const form1040 = evaluateForm1040(ctx, scheduleD);
    const form540 = evaluateForm540(ctx, form1040);

    const filingStatus = categorizeFormProgress([form8949, scheduleD, form1040, form540]);

    console.log(`User:      ${userId}`);
    console.log(`Tax year:  ${yearArg}`);
    console.log(`Facts:     ${facts.length}`);
    console.log(`Decisions: ${decisions.length}`);
    console.log();
    printFilingStatus(filingStatus);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("inspect filing status failed:", err);
  process.exit(1);
});
