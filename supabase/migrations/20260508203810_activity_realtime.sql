-- Enable Supabase Realtime for the activity feed.
--
-- The web ActivityCard subscribes to public.tax_facts (INSERT) and
-- public.ai_decisions (INSERT + UPDATE) so new rows appear without a refetch
-- and Nynaeve's verdict flip lands without requiring another chat turn.
--
-- supabase_realtime is the default publication on hosted Supabase. Adding a
-- table here makes its WAL changes available to clients that also satisfy
-- RLS — owner-scoped policies on these tables already gate the broadcast.

alter publication supabase_realtime add table public.tax_facts;
alter publication supabase_realtime add table public.ai_decisions;

-- For UPDATEs, Postgres only sends the changed columns + primary key by
-- default. The ActivityCard's verdict-flip handler needs verdict, verdict_reason,
-- authority_citations, and verdict_at on the same payload, so widen replica
-- identity to capture the full row. tax_facts is insert-only, no change needed.

alter table public.ai_decisions replica identity full;
