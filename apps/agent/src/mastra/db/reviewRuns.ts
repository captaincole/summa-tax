import type { SupabaseClient } from "@supabase/supabase-js";

// Persistence for the review-decision workflow. Two tables:
//   review_runs       — one row per workflow execution
//   review_run_steps  — one row per step invocation across iterations
//
// Both are user-scoped via RLS on user_id, so all writes go through the
// per-request supabase client (not the admin pool).
//
// review_run_steps rows are the training-data substrate for future fine-tuning
// (filter by step_kind to extract per-step (input, output) pairs). Keep the
// JSON columns raw — no summarization at write time.

export type ReviewRunStatus = "running" | "completed" | "failed";
export type ReviewStepKind = "init" | "gather" | "assess" | "rule" | "finalize";

export interface InsertReviewRunArgs {
  id: string;
  decisionId: string;
  userId: string;
  filingId: string;
}

export async function insertReviewRun(
  supabase: SupabaseClient,
  args: InsertReviewRunArgs,
): Promise<void> {
  const { error } = await supabase.from("review_runs").insert({
    id: args.id,
    decision_id: args.decisionId,
    user_id: args.userId,
    filing_id: args.filingId,
    status: "running",
  });
  if (error) throw new Error(`insertReviewRun failed: ${error.message}`);
}

export interface CompleteReviewRunArgs {
  id: string;
  status: Exclude<ReviewRunStatus, "running">;
  finalVerdict: string | null;
  iterationCount: number;
  durationMs: number;
  error?: string;
}

export async function completeReviewRun(
  supabase: SupabaseClient,
  args: CompleteReviewRunArgs,
): Promise<void> {
  const { error } = await supabase
    .from("review_runs")
    .update({
      status: args.status,
      final_verdict: args.finalVerdict,
      iteration_count: args.iterationCount,
      duration_ms: args.durationMs,
      completed_at: new Date().toISOString(),
      error: args.error ?? null,
    })
    .eq("id", args.id);
  if (error) throw new Error(`completeReviewRun failed: ${error.message}`);
}

export interface RecordStepArgs {
  id: string;
  runId: string;
  userId: string;
  filingId: string;
  iteration: number;
  stepKind: ReviewStepKind;
  input: unknown;
  output: unknown;
  durationMs: number;
}

export async function recordReviewStep(
  supabase: SupabaseClient,
  args: RecordStepArgs,
): Promise<void> {
  const { error } = await supabase.from("review_run_steps").insert({
    id: args.id,
    run_id: args.runId,
    user_id: args.userId,
    filing_id: args.filingId,
    iteration: args.iteration,
    step_kind: args.stepKind,
    input_json: args.input,
    output_json: args.output,
    duration_ms: args.durationMs,
  });
  if (error) throw new Error(`recordReviewStep failed: ${error.message}`);
}

export async function setDecisionLatestRunId(
  supabase: SupabaseClient,
  decisionId: string,
  runId: string,
): Promise<void> {
  const { error } = await supabase
    .from("ai_decisions")
    .update({ latest_review_run_id: runId })
    .eq("id", decisionId);
  if (error)
    throw new Error(`setDecisionLatestRunId failed: ${error.message}`);
}
