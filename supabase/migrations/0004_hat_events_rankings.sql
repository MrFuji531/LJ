-- ============================================================================
--  LJ — the hat record, the year-in-review ledger, MCU rankings & portraits
--
--  Run in the Supabase SQL Editor. Safe to re-run: everything is idempotent.
-- ============================================================================

-- ---- mcu: our joint ranking of watched entries + uploaded portraits --------

alter table public.lj_mcu_films
  add column if not exists rank int,
  add column if not exists rank_excluded boolean default false;

alter table public.lj_mcu_chars
  add column if not exists image_path text,
  add column if not exists image_thumb text;

-- ---- the hat record --------------------------------------------------------

create table if not exists public.lj_hat_log (
  id          uuid primary key default gen_random_uuid(),
  activity    text not null,
  done_on     date,
  photo_path  text,
  photo_thumb text,
  added_by    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ---- the year-in-review ledger ---------------------------------------------
--  One row per moment. The id is deterministic (room:kind:ref), so re-logging
--  the same moment (e.g. after a date correction) overwrites, not duplicates.

create table if not exists public.lj_events (
  id          text primary key,
  room        text not null,
  kind        text not null,
  ref_id      text,
  label       text,
  happened_on date,
  meta        jsonb default '{}'::jsonb,
  added_by    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists lj_events_when_idx on public.lj_events (happened_on);
create index if not exists lj_events_room_idx on public.lj_events (room);

-- ---- RLS, realtime and updated_at for the new tables -----------------------

do $$
declare t text;
begin
  foreach t in array array['lj_hat_log', 'lj_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lj_all on public.%I', t);
    execute format(
      'create policy lj_all on public.%I for all to authenticated using (true) with check (true)', t
    );

    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;

    execute format('drop trigger if exists lj_touch_trg on public.%I', t);
    execute format(
      'create trigger lj_touch_trg before insert or update on public.%I
         for each row execute function public.lj_touch()', t
    );
  end loop;
end $$;
