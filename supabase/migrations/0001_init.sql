-- ============================================================================
--  LJ — schema
--
--  Run this once in the Supabase SQL Editor.
--
--  ⚠️  BEFORE RUNNING: change the passcode on the next line. It becomes the
--      shared passcode both of you type on the sign-in screen.
-- ============================================================================

\set passcode 'change-me'
-- If you're pasting into the web SQL Editor (which ignores \set), instead
-- find-and-replace every :'passcode' below with 'your-passcode-here'.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
--  Accounts
--
--  The UX is "pick who you are + one shared passcode", but underneath these
--  are real auth users, so row-level security genuinely applies: the data is
--  unreadable to anyone holding only the URL and the anon key.
-- ---------------------------------------------------------------------------

do $$
declare
  v_email text;
  v_id uuid;
  v_pass text := :'passcode';
begin
  foreach v_email in array array['james@lj.app', 'lee@lj.app'] loop
    select id into v_id from auth.users where email = v_email;

    if v_id is null then
      v_id := gen_random_uuid();

      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        v_email, extensions.crypt(v_pass, extensions.gen_salt('bf')),
        now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
      );

      -- GoTrue needs a matching identity row or password sign-in 400s.
      insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        gen_random_uuid(), v_id, v_id::text,
        jsonb_build_object('sub', v_id::text, 'email', v_email),
        'email', now(), now(), now()
      );
    else
      -- Re-running this file resets the passcode rather than erroring.
      update auth.users
         set encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf')),
             email_confirmed_at = coalesce(email_confirmed_at, now()),
             updated_at = now()
       where id = v_id;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
--  Server clock — used to keep shared countdowns in step across both phones
-- ---------------------------------------------------------------------------

create or replace function public.lj_server_time()
returns timestamptz language sql stable as $$ select now() $$;

grant execute on function public.lj_server_time() to authenticated, anon;

-- ---------------------------------------------------------------------------
--  Tables
-- ---------------------------------------------------------------------------

create table if not exists public.lj_app (
  id                 int primary key default 1 check (id = 1),
  hat_activity       text,
  hat_updated_by     text,
  active_position_id int,
  updated_at         timestamptz default now()
);

create table if not exists public.lj_positions (
  position_id int primary key,
  status      text not null check (status in ('completed', 'removed')),
  rating      text check (rating in ('dislike', 'like', 'favorite')),
  rated_by    text,
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists public.lj_equipment (
  item       text primary key,
  blocked    boolean not null default true,
  updated_at timestamptz default now()
);

create table if not exists public.lj_cuisines (
  country      text primary key,
  status       text not null check (status in ('ranked', 'unavailable', 'pending')),
  rank         int,
  where_to_get text,
  notes        text,
  decided_by   text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists public.lj_titles (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('movie', 'tv')),
  tmdb_id      int,
  title        text not null,
  year         int,
  genres       text[] default '{}',
  poster_path  text,
  overview     text,
  runtime      int,
  seasons      int,
  episodes     int,
  director     text,
  cast_list    text[] default '{}',
  language     text,
  country      text,
  release_date date,
  watched_on   date,
  score_james  numeric(3,1) check (score_james between 0 and 10),
  score_lee    numeric(3,1) check (score_lee between 0 and 10),
  notes_james  text,
  notes_lee    text,
  added_by     text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists public.lj_watchlist (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('movie', 'tv')),
  tmdb_id      int,
  title        text not null,
  year         int,
  poster_path  text,
  overview     text,
  genres       text[] default '{}',
  release_date date,
  notes        text,
  added_by     text,
  done         boolean default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists public.lj_venues (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('nachos', 'salad')),
  name        text not null,
  suburb      text,
  address     text,
  url         text,
  price       numeric(7,2),
  notes       text,
  visited     boolean default false,
  visited_on  date,
  score_james numeric(3,1) check (score_james between 0 and 10),
  score_lee   numeric(3,1) check (score_lee between 0 and 10),
  notes_james text,
  notes_lee   text,
  added_by    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists public.lj_todos (
  id         uuid primary key default gen_random_uuid(),
  text       text not null,
  category   text,
  done       boolean default false,
  done_at    timestamptz,
  due_date   date,
  notes      text,
  added_by   text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- MCU rewatch: one row per film, plus a franchise-level cast board. Characters
-- are rated once overall (Loki turns up six times; he doesn't need six scores),
-- with `film_slug` recording where you first met them.
create table if not exists public.lj_mcu_films (
  slug        text primary key,
  watched     boolean default false,
  watched_on  date,
  poster_path text,
  score_james numeric(3,1) check (score_james between 0 and 10),
  score_lee   numeric(3,1) check (score_lee between 0 and 10),
  notes_james text,
  notes_lee   text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists public.lj_mcu_chars (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null check (kind in ('hero', 'villain', 'love')),
  actor       text,
  image_url   text,
  film_slug   text,
  score_james numeric(3,1) check (score_james between 0 and 10),
  score_lee   numeric(3,1) check (score_lee between 0 and 10),
  notes_james text,
  notes_lee   text,
  added_by    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists lj_mcu_chars_kind_idx on public.lj_mcu_chars (kind);
create index if not exists lj_titles_kind_idx    on public.lj_titles (kind);
create index if not exists lj_venues_kind_idx    on public.lj_venues (kind);
create index if not exists lj_cuisines_rank_idx  on public.lj_cuisines (rank);
create index if not exists lj_watchlist_rel_idx  on public.lj_watchlist (release_date);

-- ---------------------------------------------------------------------------
--  Row-level security
--
--  Only the two accounts above exist, and both see everything. The point is
--  that an unauthenticated caller — anyone with just the anon key — sees
--  nothing at all.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'lj_app', 'lj_positions', 'lj_equipment', 'lj_cuisines',
    'lj_titles', 'lj_watchlist', 'lj_venues', 'lj_todos',
    'lj_mcu_films', 'lj_mcu_chars'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists lj_all on public.%I', t);
    execute format(
      'create policy lj_all on public.%I for all to authenticated using (true) with check (true)', t
    );

    -- Scoped to this one statement: a table already in the publication must
    -- not abort the loop and leave later tables without RLS.
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

-- Keep updated_at honest even for writes that forget to set it.
create or replace function public.lj_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'lj_app', 'lj_positions', 'lj_equipment', 'lj_cuisines',
    'lj_titles', 'lj_watchlist', 'lj_venues', 'lj_todos',
    'lj_mcu_films', 'lj_mcu_chars'
  ] loop
    execute format('drop trigger if exists lj_touch_trg on public.%I', t);
    execute format(
      'create trigger lj_touch_trg before insert or update on public.%I
         for each row execute function public.lj_touch()', t
    );
  end loop;
end $$;
