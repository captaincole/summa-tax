-- Add 'processing' as a valid status for requested_actions. Lifecycle:
--
--   open       → Thom posted the card; user hasn't acted
--   processing → user clicked Upload and the file is in Storage, but
--                Thom hasn't confirmed it satisfies the request yet
--   resolved   → Thom called dismiss-requested-action after ingesting
--   skipped    → user dismissed via the Skip button
--   dismissed  → reserved for "Thom decided no longer needed"
--
-- The original check constraint allowed only {open, resolved, skipped,
-- dismissed}. We drop and recreate to widen the set. `if exists` keeps
-- this safe to re-run.

alter table public.requested_actions
  drop constraint if exists requested_actions_status_check;

alter table public.requested_actions
  add constraint requested_actions_status_check
  check (status in ('open', 'processing', 'resolved', 'skipped', 'dismissed'));
