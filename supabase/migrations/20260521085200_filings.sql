-- Filings — the new ownership root.
--
-- Until now, every user-data row was owned by a single auth.users id via the
-- `user_id` column, and RLS gated reads/writes with `user_id = auth.uid()`.
-- This migration introduces an explicit filing entity so a return can be
-- shared with multiple parties (e.g. the taxpayer + a CPA reviewer) without
-- duplicating rows or hand-rolling per-table OR-extensions to RLS.
--
-- Shape:
--   filings           — one row per (taxpayer, tax_year); id is uuid.
--   filing_members    — membership table; (filing_id, user_id, role).
--                       Roles today: owner, cpa_reviewer.
--   every domain table gets `filing_id uuid not null references filings(id)`.
--                       RLS becomes a single EXISTS predicate against
--                       filing_members for every domain table.
--
-- `user_id` is intentionally retained on every domain row as a denormalized
-- cache. Rationale: existing PostgREST queries + realtime filters in the web
-- app filter by `user_id=eq.<uuid>` directly; keeping the column lets that
-- code keep working unchanged. Same justification as keeping `tax_year`
-- denormalized — a filing's user_id (its owner) is effectively immutable,
-- and 16 bytes/row is the cost of not breaking every existing query.
--
-- Data-model policy (see CLAUDE.md "Data-model iteration"): we don't backfill
-- existing rows. Local dev wipes-and-reingests; the seed_filings.sql script
-- under supabase/scripts/ is run manually against prod after this migration
-- to materialize filings for the existing two test users.

-- ---------------------------------------------------------------------------
-- filings — one row per (taxpayer, tax_year).
-- ---------------------------------------------------------------------------
create table filings (
  id          uuid primary key default gen_random_uuid(),
  tax_year    integer not null,
  status      text not null default 'draft',
  created_at  timestamptz not null default now()
);

alter table filings enable row level security;

-- ---------------------------------------------------------------------------
-- filing_members — symmetric ownership/access table.
-- (filing_id, user_id) is the natural key; role is just the access level.
-- revoked_at lets us soft-disable a CPA share without deleting history.
-- ---------------------------------------------------------------------------
create table filing_members (
  filing_id   uuid not null references filings(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner', 'cpa_reviewer')),
  added_at    timestamptz not null default now(),
  revoked_at  timestamptz,
  primary key (filing_id, user_id)
);

create index idx_filing_members_user on filing_members(user_id) where revoked_at is null;
create index idx_filing_members_filing on filing_members(filing_id) where revoked_at is null;

alter table filing_members enable row level security;

-- ---------------------------------------------------------------------------
-- RLS — filings
--
-- A user can read a filing if they have an active membership for it. We
-- avoid `select` policies that re-query filing_members directly (would
-- recurse via filing_members's own RLS); the EXISTS predicate is fine
-- because Postgres evaluates the subquery against the table's RLS, and
-- filing_members's RLS treats "your own membership rows" as readable.
--
-- Inserts/updates on filings are deliberately restricted to the service
-- role for now. Once we expose a "Start your 2026 return" affordance,
-- we'll add a permissive policy + trigger that auto-creates an owner
-- membership.
-- ---------------------------------------------------------------------------
create policy "filings: member read"
  on filings for select
  using (
    exists (
      select 1
      from filing_members fm
      where fm.filing_id = filings.id
        and fm.user_id = auth.uid()
        and fm.revoked_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- RLS — filing_members
--
-- Read: you can see your own membership rows, plus the owner can see
--       every member of a filing they own (to manage shares).
-- Write: only the service role can grant/revoke. Owner-driven sharing
--        goes through the agent's tool surface or a route handler that
--        runs as service-role and verifies the caller is the filing's
--        owner — keeps the policy small.
-- ---------------------------------------------------------------------------
create policy "filing_members: self read"
  on filing_members for select
  using (user_id = auth.uid());

-- A "filing_members: owner read peers" policy used to live here so an owner
-- could see every CPA invited to their filing. It caused infinite-recursion
-- RLS errors because the policy referenced filing_members in its own EXISTS
-- predicate — every domain-table policy that did `exists (... filing_members)`
-- triggered a SELECT on filing_members → owner-read-peers fires → another
-- SELECT on filing_members → loop. When we add the "owner manages CPA shares"
-- UI, re-introduce peer reading via a `security definer` SQL function that
-- bypasses RLS for the lookup (standard pattern for breaking RLS recursion).

-- ---------------------------------------------------------------------------
-- Helper: predicate the domain-table policies share. Inlined into each
-- table's policies since Postgres can't reference functions across RLS
-- without security-definer gymnastics, and EXISTS plans cleanly against
-- the partial idx_filing_members_user index.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- tax_facts
-- ---------------------------------------------------------------------------
alter table tax_facts add column filing_id uuid references filings(id) on delete cascade;
create index idx_tax_facts_filing on tax_facts(filing_id);

drop policy "tax_facts: owner read" on tax_facts;
drop policy "tax_facts: owner insert" on tax_facts;
drop policy "tax_facts: owner update" on tax_facts;
drop policy "tax_facts: owner delete" on tax_facts;

create policy "tax_facts: member read"
  on tax_facts for select
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = tax_facts.filing_id
        and fm.user_id = auth.uid()
        and fm.revoked_at is null
    )
  );

create policy "tax_facts: owner write"
  on tax_facts for insert
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = tax_facts.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "tax_facts: owner update"
  on tax_facts for update
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = tax_facts.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = tax_facts.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "tax_facts: owner delete"
  on tax_facts for delete
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = tax_facts.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- open_questions
-- ---------------------------------------------------------------------------
alter table open_questions add column filing_id uuid references filings(id) on delete cascade;
create index idx_open_questions_filing on open_questions(filing_id);

drop policy "open_questions: owner read" on open_questions;
drop policy "open_questions: owner insert" on open_questions;
drop policy "open_questions: owner update" on open_questions;
drop policy "open_questions: owner delete" on open_questions;

create policy "open_questions: member read"
  on open_questions for select
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = open_questions.filing_id
        and fm.user_id = auth.uid()
        and fm.revoked_at is null
    )
  );

create policy "open_questions: owner write"
  on open_questions for insert
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = open_questions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "open_questions: owner update"
  on open_questions for update
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = open_questions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = open_questions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "open_questions: owner delete"
  on open_questions for delete
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = open_questions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- ai_decisions
-- ---------------------------------------------------------------------------
alter table ai_decisions add column filing_id uuid references filings(id) on delete cascade;
create index idx_ai_decisions_filing on ai_decisions(filing_id);

drop policy "ai_decisions: owner read" on ai_decisions;
drop policy "ai_decisions: owner insert" on ai_decisions;
drop policy "ai_decisions: owner update" on ai_decisions;
drop policy "ai_decisions: owner delete" on ai_decisions;

create policy "ai_decisions: member read"
  on ai_decisions for select
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = ai_decisions.filing_id
        and fm.user_id = auth.uid()
        and fm.revoked_at is null
    )
  );

create policy "ai_decisions: owner write"
  on ai_decisions for insert
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = ai_decisions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "ai_decisions: owner update"
  on ai_decisions for update
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = ai_decisions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = ai_decisions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "ai_decisions: owner delete"
  on ai_decisions for delete
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = ai_decisions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- user_documents
-- ---------------------------------------------------------------------------
alter table user_documents add column filing_id uuid references filings(id) on delete cascade;
create index idx_user_documents_filing on user_documents(filing_id);

drop policy "user_documents: owner read" on user_documents;
drop policy "user_documents: owner insert" on user_documents;
drop policy "user_documents: owner update" on user_documents;
drop policy "user_documents: owner delete" on user_documents;

create policy "user_documents: member read"
  on user_documents for select
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = user_documents.filing_id
        and fm.user_id = auth.uid()
        and fm.revoked_at is null
    )
  );

create policy "user_documents: owner write"
  on user_documents for insert
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = user_documents.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "user_documents: owner update"
  on user_documents for update
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = user_documents.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = user_documents.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "user_documents: owner delete"
  on user_documents for delete
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = user_documents.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- Storage objects — bucket-level policies on storage.objects
--
-- Path convention flips from {userId}/{category}/... to {filingId}/{category}/...
-- so the policy can extract filing_id from the first folder segment and
-- check membership the same way row policies do.
-- ---------------------------------------------------------------------------
drop policy "user-documents: owner read" on storage.objects;
drop policy "user-documents: owner insert" on storage.objects;
drop policy "user-documents: owner update" on storage.objects;
drop policy "user-documents: owner delete" on storage.objects;

create policy "user-documents: member read"
  on storage.objects for select
  using (
    bucket_id = 'user-documents'
    and exists (
      select 1 from filing_members fm
      where fm.filing_id::text = (storage.foldername(name))[1]
        and fm.user_id = auth.uid()
        and fm.revoked_at is null
    )
  );

create policy "user-documents: owner write"
  on storage.objects for insert
  with check (
    bucket_id = 'user-documents'
    and exists (
      select 1 from filing_members fm
      where fm.filing_id::text = (storage.foldername(name))[1]
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "user-documents: owner update"
  on storage.objects for update
  using (
    bucket_id = 'user-documents'
    and exists (
      select 1 from filing_members fm
      where fm.filing_id::text = (storage.foldername(name))[1]
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  )
  with check (
    bucket_id = 'user-documents'
    and exists (
      select 1 from filing_members fm
      where fm.filing_id::text = (storage.foldername(name))[1]
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "user-documents: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'user-documents'
    and exists (
      select 1 from filing_members fm
      where fm.filing_id::text = (storage.foldername(name))[1]
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- review_runs + review_run_steps
-- ---------------------------------------------------------------------------
alter table review_runs add column filing_id uuid references filings(id) on delete cascade;
create index idx_review_runs_filing on review_runs(filing_id);

drop policy "review_runs: owner read" on review_runs;
drop policy "review_runs: owner insert" on review_runs;
drop policy "review_runs: owner update" on review_runs;
drop policy "review_runs: owner delete" on review_runs;

create policy "review_runs: member read"
  on review_runs for select
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_runs.filing_id
        and fm.user_id = auth.uid()
        and fm.revoked_at is null
    )
  );

create policy "review_runs: owner write"
  on review_runs for insert
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_runs.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "review_runs: owner update"
  on review_runs for update
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_runs.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_runs.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "review_runs: owner delete"
  on review_runs for delete
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_runs.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

alter table review_run_steps add column filing_id uuid references filings(id) on delete cascade;
create index idx_review_run_steps_filing on review_run_steps(filing_id);

drop policy "review_run_steps: owner read" on review_run_steps;
drop policy "review_run_steps: owner insert" on review_run_steps;
drop policy "review_run_steps: owner update" on review_run_steps;
drop policy "review_run_steps: owner delete" on review_run_steps;

create policy "review_run_steps: member read"
  on review_run_steps for select
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_run_steps.filing_id
        and fm.user_id = auth.uid()
        and fm.revoked_at is null
    )
  );

create policy "review_run_steps: owner write"
  on review_run_steps for insert
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_run_steps.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "review_run_steps: owner update"
  on review_run_steps for update
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_run_steps.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_run_steps.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "review_run_steps: owner delete"
  on review_run_steps for delete
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = review_run_steps.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

-- ---------------------------------------------------------------------------
-- requested_actions
-- ---------------------------------------------------------------------------
alter table requested_actions add column filing_id uuid references filings(id) on delete cascade;
create index idx_requested_actions_filing on requested_actions(filing_id);

drop policy "requested_actions: owner read" on requested_actions;
drop policy "requested_actions: owner insert" on requested_actions;
drop policy "requested_actions: owner update" on requested_actions;
drop policy "requested_actions: owner delete" on requested_actions;

create policy "requested_actions: member read"
  on requested_actions for select
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = requested_actions.filing_id
        and fm.user_id = auth.uid()
        and fm.revoked_at is null
    )
  );

create policy "requested_actions: owner write"
  on requested_actions for insert
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = requested_actions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "requested_actions: owner update"
  on requested_actions for update
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = requested_actions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = requested_actions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

create policy "requested_actions: owner delete"
  on requested_actions for delete
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = requested_actions.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );
