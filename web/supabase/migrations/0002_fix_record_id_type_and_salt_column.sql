-- LifeVault — 0002: fix record id type + dedicated salt column
-- Run once in the Supabase SQL editor (or via the Management API).
-- Safe to re-run: every statement is idempotent.
--
-- Bug fixed: "invalid input syntax for type uuid: '__salt__'"
--   • The app stored the encryption salt as a magic row (id = '__salt__')
--     in vault_records, but vault_records.id was UUID — the INSERT and every
--     id = / id <> '__salt__' filter failed with a uuid cast error.
--   • Client record ids are non-UUID strings anyway ("doc_kx8…",
--     "__settings__", "__security__"), so the id column must be TEXT.
--   • The salt is account metadata, not a record: it now lives in a
--     dedicated TEXT column on sync_state. After this migration the only
--     uuid column is user_id, which only ever receives auth.uid().

-- ----------------------------------------------------------------------
-- 1. vault_records.id: uuid → text (client-generated ids are strings).
--    Preserves the (user_id, id) primary key and all RLS policies.
-- ----------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'vault_records'
      and column_name  = 'id'
      and data_type    = 'uuid'
  ) then
    alter table public.vault_records
      alter column id type text using id::text;
  end if;
end $$;

-- ----------------------------------------------------------------------
-- 2. sync_state.salt: per-user encryption salt (base64 TEXT, never uuid).
-- ----------------------------------------------------------------------
alter table public.sync_state
  add column if not exists salt text;

-- ----------------------------------------------------------------------
-- 3. Defensive cleanup: drop any legacy magic salt rows from vault_records
--    (none can exist on databases where id was uuid — inserts failed —
--    but this keeps the migration correct for any schema history).
-- ----------------------------------------------------------------------
delete from public.vault_records where id = '__salt__';
