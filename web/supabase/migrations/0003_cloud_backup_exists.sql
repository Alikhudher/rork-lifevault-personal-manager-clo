-- 0003_cloud_backup_exists.sql
--
-- Lets the app tell "no cloud backup exists for this email" apart from
-- "wrong backup password" during Unlock. Supabase Auth deliberately
-- returns the same invalid-credentials error for both, which forced the
-- app to show a misleading catch-all message.
--
-- SECURITY DEFINER so it can consult auth.users + the RLS-protected
-- tables. It exposes ONLY a single boolean (has backup / hasn't) — no
-- user ids, no password state, no record contents. This mirrors what
-- the product intentionally reveals in its own UI and is the minimum
-- disclosure needed for a truthful error message.

create or replace function public.cloud_backup_exists(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(trim(p_email))
      and (
        exists (
          select 1
          from public.sync_state s
          where s.user_id = u.id
            and coalesce(s.salt, '') <> ''
        )
        or exists (
          select 1
          from public.vault_records r
          where r.user_id = u.id
        )
      )
  );
$$;

revoke all on function public.cloud_backup_exists(text) from public;
grant execute on function public.cloud_backup_exists(text) to anon, authenticated;
