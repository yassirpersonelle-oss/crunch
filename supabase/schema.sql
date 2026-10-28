-- Crunch database. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Every row belongs to one user; row-level security lets each signed-in user see only their own rows.

create table if not exists public.kv (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.days (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

create table if not exists public.blocks (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists blocks_user_date on public.blocks (user_id, date);

create table if not exists public.push_subs (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  keys jsonb not null,
  device text,
  created_at timestamptz not null default now()
);

-- Written only by the notification function (service role): one row per notification already sent.
create table if not exists public.notif_log (
  user_id uuid not null references auth.users on delete cascade,
  tag text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, tag)
);

alter table public.kv enable row level security;
alter table public.days enable row level security;
alter table public.blocks enable row level security;
alter table public.push_subs enable row level security;
alter table public.notif_log enable row level security;

do $$ begin
  create policy own_kv on public.kv for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy own_days on public.days for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy own_blocks on public.blocks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy own_push on public.push_subs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Live sync: changes stream to every open device.
do $$ begin
  alter publication supabase_realtime add table public.kv, public.days, public.blocks;
exception when duplicate_object then null; end $$;
