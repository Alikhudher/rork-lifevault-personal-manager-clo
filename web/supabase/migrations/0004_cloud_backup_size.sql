-- LifeVault — Cloud backup size calculation
-- Returns the total byte size of all ciphertext + iv columns for the
-- calling user. This is the REAL encrypted backup size, not an estimate.
-- Safe to re-run: OR REPLACE.
--
-- RLS ensures auth.uid() = user_id, so no user can read another's size.

create or replace function public.get_cloud_backup_size()
returns bigint
language sql
security definer
set search_path = public
as $$
  select coalesce(sum(length(ciphertext) + length(iv)), 0)::bigint
  from public.vault_records
  where user_id = auth.uid();
$$;

-- Grant execute to authenticated users only.
revoke all on function public.get_cloud_backup_size() from public;
grant execute on function public.get_cloud_backup_size() to authenticated;
