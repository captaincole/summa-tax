-- Form catalog — the inventory side of the form engine. Pairs with the
-- behavior side (rule + params) declared in `apps/agent/src/mastra/forms/
-- generated/<formId>.ts`. The engine reads from this catalog (via the
-- Catalog interface in `apps/agent/src/mastra/forms/catalog.ts`) and looks
-- up the corresponding binding by fieldId at evaluation time.
--
-- Phase B (this migration): tables exist alongside the JSON fixtures in
-- `apps/agent/fixtures/forms/`. The fixtures stay authoritative; the
-- seed script (`apps/agent/scripts/seedFormCatalog.ts`) writes them here
-- so the DB loader is exercised before Phase C starts ingesting real
-- AcroForm widgets from PDFs.
--
-- Phase C+: the AI ingestion pipeline writes directly into these tables.
-- Once the pipeline output is trusted, the runtime switches its Catalog
-- loader from the fixture path to the DB path.
--
-- RLS is enabled with no public policies — only the service-role key can
-- read or write. Form metadata is shared across users; the per-user
-- supabase client doesn't need to see it. This matches the ref_documents
-- pattern (see 20260501174341_ref_corpus_schema.sql).

-- ---------------------------------------------------------------------------
-- forms — one row per (form_id, tax_year). Form metadata persists across
-- years, but per-year rows let us evolve titles / line counts without
-- invalidating older returns.
-- ---------------------------------------------------------------------------
create table forms (
  form_id      text not null,
  tax_year     integer not null,
  jurisdiction text not null,
  title        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (form_id, tax_year)
);

create index idx_forms_tax_year on forms(tax_year);

alter table forms enable row level security;

-- ---------------------------------------------------------------------------
-- form_fields — one row per fillable field per (form, tax_year).
--
-- Ordinal drives evaluation order in the engine: bindings are run top-to-
-- bottom so intra-form arithmetic (line 11 = line 9 − line 10) just works
-- when the inventory is ordered naturally.
--
-- pdf_widget_name + position are populated by Phase C's AcroForm
-- extraction step (the deterministic spine that pdf-lib gives us). They
-- can be NULL for forms ingested before that step exists (e.g. the Phase
-- B seed of form-1040 has no widget info yet).
-- ---------------------------------------------------------------------------
create table form_fields (
  field_id        text not null,
  form_id         text not null,
  tax_year        integer not null,
  ordinal         integer not null,
  label           text not null,
  category        text not null,
  value_type      text not null,
  pdf_widget_name text,
  position        jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (field_id, tax_year),
  foreign key (form_id, tax_year)
    references forms(form_id, tax_year)
    on delete cascade
);

create index idx_form_fields_form on form_fields(form_id, tax_year, ordinal);

alter table form_fields enable row level security;
