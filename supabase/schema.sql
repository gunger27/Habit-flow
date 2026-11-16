-- HabitFlow cloud sync. Run this once in Supabase SQL Editor.
create table if not exists public.habits (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  interval_days integer not null check (interval_days between 1 and 365),
  start_date date not null,
  completions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

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
