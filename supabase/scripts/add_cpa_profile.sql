-- Promote an existing auth user into a registered CPA.
--
-- The user must already exist in auth.users (i.e. they've signed up via
-- the web app). Look up by email + upsert into public.cpa_profiles. The
-- ON CONFLICT clause makes this safe to re-run — second run updates the
-- display name / firm / license in place rather than erroring.
--
-- How to run:
--   Supabase Studio → SQL Editor → paste this whole file → edit the
--   three placeholder values below → Run.
--
--   Or via psql against the prod database URL:
--     psql "$POSTGRES_URL" -f supabase/scripts/add_cpa_profile.sql
--   (after editing the placeholders).
--
-- After running, the CPA will appear in the Share page directory grid
-- for every taxpayer on the platform.

insert into public.cpa_profiles (user_id, display_name, firm, license_number)
select
  id,
  'Ed White, CPA'    as display_name,    -- EDIT: how the picker shows them
  'Attain Finance'   as firm,            -- EDIT: firm name, or null
  'CA-XXXXX'         as license_number   -- EDIT: state-issued CPA license, or null
from auth.users
where email = 'ed@attainfinance.io'      -- EDIT: the CPA's signup email
on conflict (user_id) do update set
  display_name   = excluded.display_name,
  firm           = excluded.firm,
  license_number = excluded.license_number
returning user_id, display_name, firm, license_number;
