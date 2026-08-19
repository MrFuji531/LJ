-- ============================================================================
--  LJ — shared config
--
--  Small key/value table for app-level settings both phones should share —
--  first occupant: the TMDb API key, so neither phone needs any setup.
--  Readable only with an authenticated session, like everything else.
-- ============================================================================

create table if not exists public.lj_config (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);

alter table public.lj_config enable row level security;
drop policy if exists lj_all on public.lj_config;
create policy lj_all on public.lj_config
  for all to authenticated using (true) with check (true);

drop trigger if exists lj_touch_trg on public.lj_config;
create trigger lj_touch_trg before insert or update on public.lj_config
  for each row execute function public.lj_touch();
