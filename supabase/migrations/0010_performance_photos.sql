alter table public.lj_performances
  add column if not exists photo_path text,
  add column if not exists photo_thumb text;
