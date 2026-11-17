-- HabitFlow cloud sync. Run this once in Supabase SQL Editor.
create table if not exists public.habits (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  interval_days integer not null check (interval_days between 1 and 365),
  start_date date not null,
  tracking_type text not null default 'checkbox',
  unit text not null default '',
  daily_target numeric,
  client_schema integer not null default 1,
  completions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Upgrade an existing table safely. Existing habits stay checkbox habits.
alter table public.habits add column if not exists tracking_type text not null default 'checkbox';
alter table public.habits add column if not exists unit text not null default '';
alter table public.habits add column if not exists daily_target numeric;
alter table public.habits add column if not exists client_schema integer not null default 1;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'habits_tracking_type_check' and conrelid = 'public.habits'::regclass) then
    alter table public.habits add constraint habits_tracking_type_check check (tracking_type in ('checkbox', 'quantity'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'habits_unit_length_check' and conrelid = 'public.habits'::regclass) then
    alter table public.habits add constraint habits_unit_length_check check (char_length(unit) <= 24);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'habits_daily_target_check' and conrelid = 'public.habits'::regclass) then
    alter table public.habits add constraint habits_daily_target_check check (daily_target is null or daily_target > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'habits_client_schema_check' and conrelid = 'public.habits'::regclass) then
    alter table public.habits add constraint habits_client_schema_check check (client_schema >= 1);
  end if;
end $$;

-- Older installed clients do not know about quantity habits. Preserve their
-- type settings and numeric day entries if an older client writes the same row.
create or replace function public.preserve_quantity_data_from_legacy_clients()
returns trigger
language plpgsql
as $$
declare
  entry record;
begin
  if tg_op = 'UPDATE' and old.tracking_type = 'quantity' and new.client_schema < 2 then
    new.tracking_type := old.tracking_type;
    new.unit := old.unit;
    new.daily_target := old.daily_target;
    for entry in select key, value from jsonb_each(coalesce(old.completions, '{}'::jsonb)) loop
      if jsonb_typeof(entry.value) = 'object' and (entry.value ? 'value' or entry.value->>'deleted' = 'true') then
        new.completions := coalesce(new.completions, '{}'::jsonb) || jsonb_build_object(entry.key, entry.value);
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists habits_preserve_quantity_data on public.habits;
create trigger habits_preserve_quantity_data
  before update on public.habits
  for each row execute function public.preserve_quantity_data_from_legacy_clients();

create index if not exists habits_user_updated_idx
  on public.habits (user_id, updated_at desc);

alter table public.habits enable row level security;
revoke all on table public.habits from anon;
grant select, insert, update, delete on table public.habits to authenticated;

drop policy if exists "Users can read their own habits" on public.habits;
create policy "Users can read their own habits"
  on public.habits for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own habits" on public.habits;
create policy "Users can insert their own habits"
  on public.habits for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own habits" on public.habits;
create policy "Users can update their own habits"
  on public.habits for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own habits" on public.habits;
create policy "Users can delete their own habits"
  on public.habits for delete to authenticated
  using (auth.uid() = user_id);

-- Needed for Supabase Realtime change notifications.
do $$ begin
  alter publication supabase_realtime add table public.habits;
exception when duplicate_object then null;
end $$;

