-- User-document storage. Two layers:
--
--   1. `user-documents` bucket on Supabase Storage — physical file home, with
--      per-user folder scoping enforced by RLS on storage.objects. Path
--      convention is `{userId}/{category}/{ulid-suffixed-filename}` so
--      `(storage.foldername(name))[1] = auth.uid()` cleanly scopes access.
--
--   2. `public.user_documents` table — the metadata layer. Source of truth for
--      "what files does this user have, what category, when, when do they
--      expire." Append-only: each generate-tax-documents run inserts new
--      rows so old chat-message links to historical drafts keep resolving
--      until the row's expires_at passes. The public download URL is opaque
--      `/documents/{uuid}` — frontend and chat never see the storage path.
--      Storage filenames carry a ULID suffix to avoid collisions across
--      regenerations.
--
-- Categories:
--   - drafts:  auto-generated forms (1040, 8949, etc.). Soft-expiring (we
--              set expires_at = now() + 30 days; cleanup is a future job).
--   - finals:  post-CPA-signoff copies. Immutable. expires_at null.
--   - uploads: user-supplied source docs (W-2s, 1099s, receipts).
--              Immutable. expires_at null.
--
-- `scenario` is a nullable text column reserved for future scenario planning
-- (what-if comparisons). For now everything sets it to NULL or 'default';
-- when a `scenarios` table lands, this column either migrates to a FK or
-- starts holding scenario UUIDs.

-- ---------------------------------------------------------------------------
-- Storage bucket + RLS on storage.objects
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('user-documents', 'user-documents', false)
on conflict (id) do nothing;

create policy "user-documents: owner read"
  on storage.objects for select
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user-documents: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user-documents: owner update"
  on storage.objects for update
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user-documents: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'user-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Metadata table
-- ---------------------------------------------------------------------------
create table user_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  category     text not null check (category in ('drafts', 'finals', 'uploads')),
  scenario     text,
  filename     text not null,
  storage_path text not null,
  size_bytes   integer,
  mime_type    text,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  metadata     jsonb
);

create index idx_user_documents_user_category on user_documents(user_id, category);
create index idx_user_documents_user_created on user_documents(user_id, created_at desc);

alter table user_documents enable row level security;

create policy "user_documents: owner read"
  on user_documents for select
  using (user_id = auth.uid());

create policy "user_documents: owner insert"
  on user_documents for insert
  with check (user_id = auth.uid());

create policy "user_documents: owner update"
  on user_documents for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_documents: owner delete"
  on user_documents for delete
  using (user_id = auth.uid());
