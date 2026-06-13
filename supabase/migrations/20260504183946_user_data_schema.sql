-- User-data schema for the Summa agent. Two concerns covered here:
--
--   1. mastra schema — created so PostgresStore({ schemaName: 'mastra' }) has a
--      home for its runtime tables (mastra_messages, mastra_threads,
--      mastra_resources, mastra_traces, …). Mastra populates the tables itself
--      on first init via @mastra/pg's createTable calls; we don't pre-define
--      them. Per-user isolation on these tables is enforced at the framework
--      layer via mapUserToResourceId + Mastra's reserved context keys
--      (MASTRA_RESOURCE_ID_KEY) — single layer, well-tested by Mastra. DB-level
--      RLS as defense-in-depth is a deliberate follow-up for after the demo;
--      see CLAUDE.md "Future architecture" notes.
--
--   2. public.tax_facts / public.open_questions / public.ai_decisions — our
--      domain tables, keyed by user_id uuid (FK to auth.users) so RLS policies
--      can scope by auth.uid(). Replaces libsql equivalents that used a
--      Luca-invented "taxpayer_id" text column. Domain helpers will move from
--      @libsql/client → supabase-js with the user's JWT in a follow-up commit;
--      RLS becomes active automatically on that client path.
--
-- Reference corpus (ref_*) is unaffected — stays in public, RLS-on with no
-- per-user policies, service_role-only access.

create schema if not exists mastra;

-- ---------------------------------------------------------------------------
-- tax_facts — verbatim user-stated facts with citations.
-- Append-only audit log; latest-value collapsing happens at read time.
-- ---------------------------------------------------------------------------
create table tax_facts (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tax_year    integer not null,
  category    text not null,
  fact_key    text not null,
  fact_value  jsonb not null,
  source_note text,
  created_at  timestamptz not null default now()
);

create index idx_tax_facts_user_year on tax_facts(user_id, tax_year);
create index idx_tax_facts_category on tax_facts(category);

alter table tax_facts enable row level security;

create policy "tax_facts: owner read"
  on tax_facts for select
  using (user_id = auth.uid());

create policy "tax_facts: owner insert"
  on tax_facts for insert
  with check (user_id = auth.uid());

create policy "tax_facts: owner update"
  on tax_facts for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "tax_facts: owner delete"
  on tax_facts for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- open_questions — Luca's questions to the user that haven't been resolved.
-- ---------------------------------------------------------------------------
create table open_questions (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  status      text not null default 'open',
  question    text not null,
  context     text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index idx_open_questions_user_status on open_questions(user_id, status);

alter table open_questions enable row level security;

create policy "open_questions: owner read"
  on open_questions for select
  using (user_id = auth.uid());

create policy "open_questions: owner insert"
  on open_questions for insert
  with check (user_id = auth.uid());

create policy "open_questions: owner update"
  on open_questions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "open_questions: owner delete"
  on open_questions for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- ai_decisions — judgment calls Luca made when facts were ambiguous.
-- Each row is reviewed synchronously by Nynaeve; verdict columns are populated
-- by the reviewDecision workflow after the initial insert.
-- ---------------------------------------------------------------------------
create table ai_decisions (
  id                        text primary key,
  user_id                   uuid not null references auth.users(id) on delete cascade,
  tax_year                  integer not null,
  decision_key              text not null,
  decision                  jsonb not null,
  rationale                 text not null,
  supporting_fact_keys      jsonb not null,
  confidence                text not null,
  dissenting_considerations text,
  authority_citations       jsonb,
  source_note               text,
  created_at                timestamptz not null default now(),
  verdict                   text,
  verdict_reason            text,
  verdict_at                timestamptz
);

create index idx_ai_decisions_user_year on ai_decisions(user_id, tax_year);
create index idx_ai_decisions_key on ai_decisions(decision_key);

alter table ai_decisions enable row level security;

create policy "ai_decisions: owner read"
  on ai_decisions for select
  using (user_id = auth.uid());

create policy "ai_decisions: owner insert"
  on ai_decisions for insert
  with check (user_id = auth.uid());

create policy "ai_decisions: owner update"
  on ai_decisions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "ai_decisions: owner delete"
  on ai_decisions for delete
  using (user_id = auth.uid());
