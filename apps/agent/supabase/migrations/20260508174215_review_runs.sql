-- Review-decision workflow persistence. Two new tables, two additive column
-- changes on existing tables.
--
-- review_runs is one row per workflow execution. review_run_steps is one row
-- per step invocation across all iterations of the loop — the shape exists
-- to make future fine-tuning datasets easy to extract (filter by step_kind,
-- read input_json/output_json). user_id is duplicated onto review_run_steps
-- so RLS doesn't have to JOIN through review_runs on every read.
--
-- ai_decisions.latest_review_run_id closes the loop from a decision row to
-- the most recent review attempt; old rows (from before the workflow runs)
-- stay null. open_questions.decision_id is populated when the workflow exits
-- with verdict='needs_more_facts' and writes an open_question to bubble back
-- to Thom; null for questions Thom raises directly.
--
-- verdict on ai_decisions remains a plain text column (no Postgres enum), so
-- adding 'needs_more_facts' as a permitted value is a code-only change.

-- ---------------------------------------------------------------------------
-- review_runs — one row per workflow execution.
-- ---------------------------------------------------------------------------
create table review_runs (
  id              text primary key,
  decision_id     text not null references ai_decisions(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  status          text not null default 'running',
  final_verdict   text,
  iteration_count integer,
  error           text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  duration_ms     integer
);

create index idx_review_runs_decision on review_runs(decision_id);
create index idx_review_runs_user on review_runs(user_id);

alter table review_runs enable row level security;

create policy "review_runs: owner read"
  on review_runs for select
  using (user_id = auth.uid());

create policy "review_runs: owner insert"
  on review_runs for insert
  with check (user_id = auth.uid());

create policy "review_runs: owner update"
  on review_runs for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "review_runs: owner delete"
  on review_runs for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- review_run_steps — one row per step invocation. Includes every iteration of
-- the gather/assess/rule loop. The (input_json, output_json) columns are the
-- training-data substrate; keep them raw, no summarization at write time.
-- ---------------------------------------------------------------------------
create table review_run_steps (
  id           text primary key,
  run_id       text not null references review_runs(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  iteration    integer not null,
  step_kind    text not null,
  input_json   jsonb not null,
  output_json  jsonb not null,
  duration_ms  integer not null,
  created_at   timestamptz not null default now()
);

create index idx_review_run_steps_run on review_run_steps(run_id);
create index idx_review_run_steps_kind on review_run_steps(step_kind);
create index idx_review_run_steps_user on review_run_steps(user_id);

alter table review_run_steps enable row level security;

create policy "review_run_steps: owner read"
  on review_run_steps for select
  using (user_id = auth.uid());

create policy "review_run_steps: owner insert"
  on review_run_steps for insert
  with check (user_id = auth.uid());

create policy "review_run_steps: owner update"
  on review_run_steps for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "review_run_steps: owner delete"
  on review_run_steps for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Existing-table additions.
-- ---------------------------------------------------------------------------
alter table ai_decisions add column if not exists latest_review_run_id text;

alter table open_questions add column if not exists decision_id text references ai_decisions(id) on delete set null;

create index if not exists idx_open_questions_decision on open_questions(decision_id);
