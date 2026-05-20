-- Requested actions — structured asks Thom surfaces to the user via the
-- dashboard's Requested Actions card. v1 only supports kind='upload' for
-- document requests (e.g. "Upload your 2025 W-2"). The shape allows for
-- future 'confirm' / 'decide' kinds but Thom doesn't emit those today.
--
-- Status flow:
--   open      → resolved (user uploaded the doc, resolved_document_id set)
--             → skipped  (user dismissed; Thom may re-ask if still needed)
--             → dismissed (Thom decided it's no longer needed)
--
-- Realtime publication is on so the frontend gets new requests + status
-- flips without polling. Replica identity is widened to full because the
-- frontend reads resolved_document_id off the UPDATE payload when an
-- action goes from open → resolved.

create table public.requested_actions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  tax_year             integer not null,
  kind                 text not null check (kind in ('upload', 'confirm', 'decide')),
  title                text not null,
  detail               text,
  document_type        text,
  accept_pattern       text,
  status               text not null default 'open'
                         check (status in ('open', 'resolved', 'skipped', 'dismissed')),
  resolved_document_id uuid references public.user_documents(id) on delete set null,
  created_at           timestamptz not null default now(),
  resolved_at          timestamptz
);

create index idx_requested_actions_user_status
  on public.requested_actions(user_id, status, tax_year);

create index idx_requested_actions_user_created
  on public.requested_actions(user_id, created_at desc);

alter table public.requested_actions enable row level security;

create policy "requested_actions: owner read"
  on public.requested_actions for select
  using (user_id = auth.uid());

create policy "requested_actions: owner insert"
  on public.requested_actions for insert
  with check (user_id = auth.uid());

create policy "requested_actions: owner update"
  on public.requested_actions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "requested_actions: owner delete"
  on public.requested_actions for delete
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.requested_actions;
alter table public.requested_actions replica identity full;
