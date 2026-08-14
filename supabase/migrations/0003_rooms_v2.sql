-- ============================================================================
--  LJ — rooms v2
--
--  Adds: watch-pile status + blind-rating pendings + new-season tracking for
--  titles, one photo per ranked cuisine, one video per venue, Lee's MCU
--  rankings, and the private media bucket that holds the photos/videos.
--
--  Run in the Supabase SQL Editor. Safe to re-run: everything is idempotent.
-- ============================================================================

-- ---- titles: the two piles + the blind-rating ritual -----------------------

alter table public.lj_titles
  add column if not exists status text
    check (status in ('towatch', 'watching', 'watched')),
  add column if not exists pending_score_james numeric(3,1)
    check (pending_score_james between 0 and 10),
  add column if not exists pending_score_lee numeric(3,1)
    check (pending_score_lee between 0 and 10),
  add column if not exists new_season boolean default false,
  add column if not exists seasons_checked_at timestamptz;

-- Anything that predates the column was a rated, watched title.
update public.lj_titles set status = 'watched' where status is null;

alter table public.lj_titles alter column status set default 'towatch';

-- ---- cuisines: one photo per eaten country ---------------------------------

alter table public.lj_cuisines
  add column if not exists photo_path text,
  add column if not exists photo_thumb text;

-- ---- venues: video evidence ------------------------------------------------

alter table public.lj_venues
  add column if not exists video_path text;

-- ---- mcu: Lee's hand-placed rankings ---------------------------------------

alter table public.lj_mcu_chars
  add column if not exists rank int;

-- ---- media bucket ----------------------------------------------------------
--  Private: objects are only reachable with an authenticated session (same
--  guarantee as the tables). 50 MB cap keeps phone videos honest.

insert into storage.buckets (id, name, public, file_size_limit)
values ('lj-media', 'lj-media', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists lj_media_rw on storage.objects;
create policy lj_media_rw on storage.objects
  for all to authenticated
  using (bucket_id = 'lj-media')
  with check (bucket_id = 'lj-media');
