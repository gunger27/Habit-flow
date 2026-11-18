-- Idempotent upgrade for existing HabitFlow Supabase projects.
-- Run in the Supabase SQL Editor before deploying the quantity-habit client.
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

