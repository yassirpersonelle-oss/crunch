-- Crunch without sign-in. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- One person uses Crunch, so every row belongs to one fixed owner id and the app's public key may
-- read and write only those rows. Nothing else in the project is opened up.

alter table public.kv        drop constraint if exists kv_user_id_fkey;
alter table public.days      drop constraint if exists days_user_id_fkey;
alter table public.blocks    drop constraint if exists blocks_user_id_fkey;
alter table public.push_subs drop constraint if exists push_subs_user_id_fkey;
alter table public.notif_log drop constraint if exists notif_log_user_id_fkey;

alter table public.kv        alter column user_id set default '00000000-0000-0000-0000-00000000c0de';
alter table public.days      alter column user_id set default '00000000-0000-0000-0000-00000000c0de';
alter table public.blocks    alter column user_id set default '00000000-0000-0000-0000-00000000c0de';
alter table public.push_subs alter column user_id set default '00000000-0000-0000-0000-00000000c0de';

drop policy if exists own_kv on public.kv;
drop policy if exists own_days on public.days;
drop policy if exists own_blocks on public.blocks;
drop policy if exists own_push on public.push_subs;
drop policy if exists owner_kv on public.kv;
drop policy if exists owner_days on public.days;
drop policy if exists owner_blocks on public.blocks;
drop policy if exists owner_push on public.push_subs;

create policy owner_kv on public.kv for all to anon, authenticated
  using (user_id = '00000000-0000-0000-0000-00000000c0de') with check (user_id = '00000000-0000-0000-0000-00000000c0de');
create policy owner_days on public.days for all to anon, authenticated
  using (user_id = '00000000-0000-0000-0000-00000000c0de') with check (user_id = '00000000-0000-0000-0000-00000000c0de');
create policy owner_blocks on public.blocks for all to anon, authenticated
  using (user_id = '00000000-0000-0000-0000-00000000c0de') with check (user_id = '00000000-0000-0000-0000-00000000c0de');
create policy owner_push on public.push_subs for all to anon, authenticated
  using (user_id = '00000000-0000-0000-0000-00000000c0de') with check (user_id = '00000000-0000-0000-0000-00000000c0de');

-- Nobody signs in any more: stop new accounts being made.
-- (Turn off "Allow new users to sign up" in Authentication -> Sign In / Providers too.)
