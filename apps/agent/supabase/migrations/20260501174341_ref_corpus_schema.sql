-- Reference-corpus schema for the IRS / FTB documents Nynaeve grounds against.
-- Mirrors the libsql shape we're moving away from (see src/mastra/db/refDocs.ts
-- in the parent commit), with Postgres-native equivalents:
--   - F32_BLOB(1024)               → vector(1024) (pgvector)
--   - libsql_vector_idx             → HNSW vector_cosine_ops
--   - FTS5 virtual table            → tsvector generated column + GIN index
--   - Per-call ensureSchema()       → this migration (run once)
--
-- All tables are RLS-on with no public policies. Only service_role reads/writes
-- the corpus today; user-facing access will be added later via SECURITY INVOKER
-- views or explicit policies.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- ref_documents — one row per ingested PDF.
-- ---------------------------------------------------------------------------
create table ref_documents (
  doc_id              text primary key,
  title               text not null,
  publisher           text not null,
  tax_year            integer,
  source_path         text not null,
  source_url          text,
  sha256              text not null,
  total_pages         integer not null,
  total_chars         integer not null,
  canonical_text_path text not null,
  ingested_at         timestamptz not null default now()
);

alter table ref_documents enable row level security;

-- ---------------------------------------------------------------------------
-- ref_pages — char-range index per page. Lets us cite "p. 14" given an offset.
-- ---------------------------------------------------------------------------
create table ref_pages (
  doc_id     text not null references ref_documents(doc_id) on delete cascade,
  page_num   integer not null,
  char_start integer not null,
  char_end   integer not null,
  primary key (doc_id, page_num)
);

alter table ref_pages enable row level security;

-- ---------------------------------------------------------------------------
-- ref_sections — heading hierarchy with stable slugs (the citable section unit).
-- ---------------------------------------------------------------------------
create table ref_sections (
  section_id        text primary key,
  doc_id            text not null references ref_documents(doc_id) on delete cascade,
  heading           text not null,
  heading_slug      text not null,
  parent_section_id text,
  ordinal           integer not null,
  first_page        integer not null,
  char_start        integer not null,
  char_end          integer not null
);

create index idx_ref_sections_doc on ref_sections(doc_id, ordinal);

alter table ref_sections enable row level security;

-- ---------------------------------------------------------------------------
-- ref_blocks — the citable unit (paragraph/list_item/etc).
-- contextualized_text = Haiku summary + "\n\n" + raw text. This is what we
-- both embed and FTS-index, so retrieval scores against the same surface
-- regardless of leg.
-- ---------------------------------------------------------------------------
create table ref_blocks (
  block_id             text primary key,
  doc_id               text not null references ref_documents(doc_id) on delete cascade,
  section_id           text references ref_sections(section_id) on delete set null,
  page_num             integer not null,
  block_type           text not null,
  ordinal              integer not null,
  text                 text not null,
  char_start           integer not null,
  char_end             integer not null,
  metadata_json        jsonb,
  contextual_summary   text,
  contextualized_text  text,
  block_text_sha1      text,
  embedding            vector(1024),
  -- Generated tsvector for FTS. Falls back to raw text when the contextualized
  -- pass was skipped (--no-contextualize ingest mode). Stored so the GIN index
  -- doesn't need to recompute on every query.
  fts                  tsvector generated always as (
                         to_tsvector('english', coalesce(contextualized_text, text))
                       ) stored
);

create index idx_ref_blocks_doc_ord on ref_blocks(doc_id, ordinal);
create index idx_ref_blocks_section on ref_blocks(section_id, ordinal);
create index idx_ref_blocks_page    on ref_blocks(doc_id, page_num);

-- HNSW for cosine NN. Default tuning (m=16, ef_construction=64); revisit if
-- recall@10 drops below 0.95 in evals.
create index idx_ref_blocks_embedding
  on ref_blocks using hnsw (embedding vector_cosine_ops);

create index idx_ref_blocks_fts on ref_blocks using gin (fts);

alter table ref_blocks enable row level security;

-- ---------------------------------------------------------------------------
-- match_ref_blocks — single entry point for retrieval.
--
-- Returns up to (2 * match_count) candidates: top-N from FTS leg unioned with
-- top-N from vector leg, deduped by block_id. The JS layer (Voyage rerank-2.5)
-- decides final order, so we don't try to normalize bm25 vs cosine here.
--
-- fts_rank is non-null when the block matched the FTS query; vector_distance
-- is non-null when the block came from the vector leg. Either or both may be
-- set for a given row (block matched both legs).
-- ---------------------------------------------------------------------------
create or replace function match_ref_blocks(
  query_embedding  vector(1024),
  query_text       text,
  match_count      integer default 50,
  filter_doc_id    text default null
)
returns table (
  block_id            text,
  doc_id              text,
  section_id          text,
  page_num            integer,
  block_type          text,
  text                text,
  contextualized_text text,
  doc_title           text,
  section_heading     text,
  fts_rank            real,
  vector_distance     real
)
language sql
stable
as $$
  with fts_hits as (
    select
      b.block_id,
      ts_rank_cd(b.fts, websearch_to_tsquery('english', coalesce(query_text, ''))) as rank
    from ref_blocks b
    where coalesce(query_text, '') <> ''
      and b.fts @@ websearch_to_tsquery('english', query_text)
      and (filter_doc_id is null or b.doc_id = filter_doc_id)
    order by rank desc
    limit match_count
  ),
  vec_hits as (
    select
      b.block_id,
      (b.embedding <=> query_embedding)::real as distance
    from ref_blocks b
    where query_embedding is not null
      and b.embedding is not null
      and (filter_doc_id is null or b.doc_id = filter_doc_id)
    order by b.embedding <=> query_embedding
    limit match_count
  ),
  merged as (
    select block_id, rank as fts_rank, null::real as vector_distance from fts_hits
    union all
    select block_id, null::real, distance from vec_hits
  ),
  deduped as (
    select
      block_id,
      max(fts_rank)        as fts_rank,
      min(vector_distance) as vector_distance
    from merged
    group by block_id
  )
  select
    b.block_id,
    b.doc_id,
    b.section_id,
    b.page_num,
    b.block_type,
    b.text,
    b.contextualized_text,
    d.title    as doc_title,
    s.heading  as section_heading,
    deduped.fts_rank,
    deduped.vector_distance
  from deduped
  join ref_blocks    b on b.block_id = deduped.block_id
  join ref_documents d on d.doc_id   = b.doc_id
  left join ref_sections s on s.section_id = b.section_id;
$$;

-- The function reads rows the caller has access to via RLS — security invoker
-- (default) is correct here. We do NOT mark it security definer.
