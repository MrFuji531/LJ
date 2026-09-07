-- ============================================================================
--  LJ — shows rate per season
--
--  A show becomes a container: one lj_seasons row per season, each with its
--  own pile status, blind-rating pendings, scores, notes and episode count.
--  The title row keeps the show-level facts plus what TMDb knows about what's
--  airing next, and gains a 'dropped' pile for shows we're not finishing.
--
--  Run in the Supabase SQL Editor. Safe to re-run: everything is idempotent.
-- ============================================================================

-- ---- titles: the dropped pile + what's airing ------------------------------

alter table public.lj_titles drop constraint if exists lj_titles_status_check;
alter table public.lj_titles
  add constraint lj_titles_status_check
    check (status in ('towatch', 'watching', 'watched', 'dropped'));

alter table public.lj_titles
  add column if not exists tmdb_status  text,
  add column if not exists next_episode jsonb,
  add column if not exists last_episode jsonb;

-- ---- seasons ---------------------------------------------------------------

create table if not exists public.lj_seasons (
  id                  uuid primary key default gen_random_uuid(),
  title_id            uuid not null references public.lj_titles(id) on delete cascade,
  season_number       int  not null,
  name                text,
  air_date            date,
  episode_count       int,
  status              text not null default 'towatch'
    check (status in ('towatch', 'watching', 'watched', 'skipped')),
  episodes_seen       int default 0,
  score_james         numeric(3,1) check (score_james between 0 and 10),
  score_lee           numeric(3,1) check (score_lee between 0 and 10),
  pending_score_james numeric(3,1) check (pending_score_james between 0 and 10),
  pending_score_lee   numeric(3,1) check (pending_score_lee between 0 and 10),
  watched_on          date,
  notes_james         text,
  notes_lee           text,
  added_by            text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (title_id, season_number)
);

create index if not exists lj_seasons_title_idx on public.lj_seasons (title_id);

-- ---- RLS, realtime and updated_at ------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['lj_seasons'] loop
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
