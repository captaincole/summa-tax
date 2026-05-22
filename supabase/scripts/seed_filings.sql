-- Seed two 2025 filings + owner memberships, one per known test user.
--
-- Run MANUALLY against Supabase (psql or the SQL editor) AFTER the
-- 20260521085200_filings.sql migration has been applied. Not a migration —
-- migrations should be idempotent and we don't want this re-firing on every
-- `supabase db push`.
--
-- Edit the two emails below to match the accounts you want seeded. If a
-- user doesn't yet exist in auth.users, sign in once via the web app
-- first so Supabase Auth creates the row, then re-run this.
--
-- Behavior:
--   - For each target email that doesn't already have a 2025 owner
--     membership, pre-generates a filing UUID in the `seeds` CTE so
--     the (user_id, filing_id) pairing survives across the two inserts.
--   - INSERTs the filing row, then INSERTs the owner membership.
--   - Safe to re-run: a user with an existing active 2025 owner
--     membership is filtered out of `seeds` and produces no inserts.
--   - Eventually this becomes the start of a local seed script for an
--     `npx supabase db reset` flow; for now it's manual.

begin;

with seeds as (
  select u.id as user_id, gen_random_uuid() as filing_id
  from auth.users u
  where u.email in (
    'rand@wheeloftime.com',     -- EDIT ME
    'cpa-reviewer@example.com'       -- EDIT ME
  )
  and not exists (
    select 1
    from public.filing_members fm
    join public.filings f on f.id = fm.filing_id
    where fm.user_id = u.id
      and f.tax_year = 2025
      and fm.role = 'owner'
      and fm.revoked_at is null
  )
),
inserted_filings as (
  insert into public.filings (id, tax_year, status)
  select filing_id, 2025, 'draft' from seeds
  returning id
)
insert into public.filing_members (filing_id, user_id, role)
select filing_id, user_id, 'owner' from seeds;

-- Sanity check: should print one owner row per seeded email.
select u.email, fm.role, f.tax_year, f.id as filing_id
from public.filing_members fm
join public.filings f on f.id = fm.filing_id
join auth.users u on u.id = fm.user_id
where u.email in (
  'rand@wheeloftime.com',
  'cpa-reviewer@example.com'
)
order by u.email;

commit;
