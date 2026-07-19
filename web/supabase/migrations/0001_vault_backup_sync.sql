-- LifeVault — Secure cloud backup & sync
-- Run this once in the Supabase SQL editor for your project.
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR REPLACE).
--
-- Design:
--   • vault_records  — one row per logical record (document, expense, etc.),
--     encrypted client-side with AES-GCM. The server only ever sees ciphertext.
--   • sync_state     — per-user pointer to the last successful sync/backup time.
--   • RLS on both tables restricts access to the calling user via auth.uid().

-- ----------------------------------------------------------------------
-- 1. vault_records
-- ----------------------------------------------------------------------
create table if not exists public.vault_records (
  id          uuid        not null,
  user_id     uuid        not null,
  kind        text        not null,
  ciphertext  text        not null,
  iv          text        not null,
  updated_at  bigint      not null,
  deleted_at  bigint,
  primary key (user_id, id)
);

create index if not exists vault_records_user_updated_idx
  on public.vault_records (user_id, updated_at);

-- ----------------------------------------------------------------------
-- 2. sync_state
-- ----------------------------------------------------------------------
create table if not exists public.sync_state (
  user_id          uuid    primary key,
  last_synced_at   bigint,
  last_backup_at   bigint,
  schema_version   integer not null default 1
);

-- ----------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------
alter table public.vault_records enable row level security;
alter table public.sync_state    enable row level security;

-- vault_records: a user can only touch their own rows.
drop policy if exists "vault_records self select" on public.vault_records;
create policy "vault_records self select"
  on public.vault_records
  for select
  using (user_id = auth.uid());

drop policy if exists "vault_records self insert" on public.vault_records;
create policy "vault_records self insert"
  on public.vault_records
  for insert
  with check (user_id = auth.uid());

drop policy if exists "vault_records self update" on public.vault_records;
create policy "vault_records self update"
  on public.vault_records
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "vault_records self delete" on public.vault_records;
create policy "vault_records self delete"
  on public.vault_records
  for delete
  using (user_id = auth.uid());

-- sync_state: a user can only touch their own row.
drop policy if exists "sync_state self select" on public.sync_state;
create policy "sync_state self select"
  on public.sync_state
  for select
  using (user_id = auth.uid());

drop policy if exists "sync_state self insert" on public.sync_state;
create policy "sync_state self insert"
  on public.sync_state
  for insert
  with check (user_id = auth.uid());

drop policy if exists "sync_state self update" on public.sync_state;
create policy "sync_state self update"
  on public.sync_state
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "sync_state self delete" on public.sync_state;
create policy "sync_state self delete"
  on public.sync_state
  for delete
  using (user_id = auth.uid());
