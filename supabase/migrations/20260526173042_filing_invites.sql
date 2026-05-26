-- filing_invites — the visible audit/lifecycle table for CPA review shares.
--
-- Why a second table (vs. owners reading filing_members directly):
-- filing_members is the access-control table — its RLS is intentionally
-- restrictive (self-read only). Letting owners read peer member rows would
-- require either a self-referential RLS predicate (Postgres rejects with
-- "infinite recursion detected") or a SECURITY DEFINER helper function
-- (works but reduces the "RLS is purely declarative" guarantee).
--
-- The cleaner split: keep filing_members strict, and put the visible
-- "who has been invited and when" data in filing_invites. The two tables
-- are kept in sync by the application layer:
--   - inviting auto-creates BOTH a filing_invites row (status='accepted',
--     accepted_at=now()) AND a filing_members row (role='cpa_reviewer').
--   - revoking flips filing_invites.status='revoked' AND
--     filing_members.revoked_at=now().
-- filing_invites can reference filing_members in its RLS predicate without
-- recursion (filing_members's policy is self-read, no further table refs).
--
-- The status column carries the lifecycle. Today every row is created with
-- status='accepted' because we have no separate accept step. Future:
-- inviting can land status='pending', the CPA can accept it manually
-- (status flips + filing_members row created), and the schema doesn't have
-- to change.

create table filing_invites (
  filing_id           uuid        not null references filings(id) on delete cascade,
  invitee_user_id     uuid        not null references auth.users(id) on delete cascade,
  invited_by_user_id  uuid        not null references auth.users(id) on delete cascade,
  status              text        not null default 'pending'
                                  check (status in ('pending', 'accepted', 'revoked')),
  invited_at          timestamptz not null default now(),
  accepted_at         timestamptz,
  revoked_at          timestamptz,
  primary key (filing_id, invitee_user_id)
);

create index idx_filing_invites_filing on filing_invites(filing_id);
create index idx_filing_invites_invitee on filing_invites(invitee_user_id);

alter table filing_invites enable row level security;

-- Owner of the filing can read every invite on it. The EXISTS predicate
-- queries filing_members, NOT filing_invites — so no recursion (the only
-- SELECT policy on filing_members is "user_id = auth.uid()", which has no
-- further table references).
create policy "filing_invites: owner read"
  on filing_invites for select
  using (
    exists (
      select 1 from filing_members fm
      where fm.filing_id = filing_invites.filing_id
        and fm.user_id = auth.uid()
        and fm.role = 'owner'
        and fm.revoked_at is null
    )
  );

-- An invitee can read their own invite row(s). Useful for the future
-- manual-accept flow ("you have a pending invite").
create policy "filing_invites: self read"
  on filing_invites for select
  using (invitee_user_id = auth.uid());

-- Writes are service-role only. The invite endpoint in the agent layer
-- does the privileged writes after verifying the caller is the filing's
-- owner. Same pattern as filing_members.

-- ---------------------------------------------------------------------------
-- cpa_profiles: browse policy for the Share page directory.
--
-- Previously cpa_profiles allowed only self-read. Owners on the Share page
-- need to see every registered CPA's display name + firm to pick one. The
-- columns are professional credentials, not private — analogous to a
-- public "find a CPA" directory. Visible to any authenticated user.
--
-- Anon stays denied (no policy on the anon role); only signed-in users
-- can list the directory.
-- ---------------------------------------------------------------------------
create policy "cpa_profiles: authenticated browse"
  on cpa_profiles for select
  to authenticated
  using (true);
