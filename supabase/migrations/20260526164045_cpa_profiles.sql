-- cpa_profiles — professional metadata for users acting as CPA reviewers.
--
-- A "CPA" in our model is just an auth.users row that holds one or more
-- non-revoked filing_members rows with role='cpa_reviewer'. The
-- cpa_profiles table is the side-channel for the professional credentials
-- we want to display in the UI ("Reviewed by Jane Doe, CPA — Acme CPA
-- Group"). It is *not* a gate on access; reviewer access is granted
-- exclusively by filing_members.
--
-- Mirrored shape with taxpayer identity (which lives in tax_facts as
-- identity-category facts) is intentionally NOT pursued here — taxpayer
-- identity is already structured tax data and re-introducing it as a
-- separate profile table would duplicate ground truth. CPA credentials
-- have no tax_facts analogue, so they live in their own table.
--
-- Population: the operator seed script (apps/agent/scripts/seedLocal.ts)
-- creates the row alongside the auth user. There is no in-app self-serve
-- "become a CPA" flow yet.

create table cpa_profiles (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null,
  firm            text,
  license_number  text,
  created_at      timestamptz not null default now()
);

alter table cpa_profiles enable row level security;

-- A CPA can read their own profile (for "edit my details" affordances).
create policy "cpa_profiles: self read"
  on cpa_profiles for select
  using (user_id = auth.uid());

-- A CPA can update their own profile.
create policy "cpa_profiles: self update"
  on cpa_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Insert and delete are intentionally not exposed via policy — both happen
-- via the service-role client (seed script today; admin-tool flow later).
--
-- A "filing owner can read the cpa_profiles of every CPA reviewing their
-- filing" policy will land once the taxpayer-side UI surfaces who's
-- reviewing them. That policy can't be written without recursion into
-- filing_members's own RLS, so when we do add it we'll do so via a
-- security definer SQL function (same workaround called out in
-- 20260521085200_filings.sql for owner-read-peers).
