-- ============================================================================
--  LJ — venue rankings
--
--  Nachos and salad sangas become checklists with a single hand-placed
--  ranking (James ranks nachos, Lee ranks sangas) and photo/video keepsakes.
-- ============================================================================

alter table public.lj_venues
  add column if not exists rank int,
  add column if not exists photo_path text,
  add column if not exists photo_thumb text;
