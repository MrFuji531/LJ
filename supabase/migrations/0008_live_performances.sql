begin;
create table if not exists public.lj_performances (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('play', 'musical', 'concert')),
  name text not null check (length(trim(name)) > 0),
  performed_on date not null,
  score_james numeric(2,1) not null check (score_james between 0 and 5),
  score_lee numeric(2,1) not null check (score_lee between 0 and 5),
  added_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.lj_performances enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lj_performances' and policyname = 'lj_all') then
    create policy lj_all on public.lj_performances for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lj_performances') then
    alter publication supabase_realtime add table public.lj_performances;
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.lj_performances'::regclass and tgname = 'lj_touch_trg') then
    create trigger lj_touch_trg before insert or update on public.lj_performances for each row execute function public.lj_touch();
  end if;
end $$;
commit;
