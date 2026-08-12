-- ============================================================================
--  LJ — seed
--
--  Everything recovered from the old Position-selector and Cuisine-selector
--  projects (codes 'HiLeeImTalkingToYouThroughCode' and 'version2baby'),
--  plus the corrections James called out.
--
--  Safe to re-run: every insert is idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Shared app state. active_position_id 51 = "The Butter Churner", which was
--  the position left up next in the old app.
-- ---------------------------------------------------------------------------

insert into public.lj_app (id, hat_activity, hat_updated_by, active_position_id)
values (1, null, null, 51)
on conflict (id) do update set active_position_id = excluded.active_position_id;

-- ---------------------------------------------------------------------------
--  Positions
-- ---------------------------------------------------------------------------

insert into public.lj_positions (position_id, status, rating, rated_by) values
   (85, 'completed', 'favorite', 'james'),  -- Harmony
    (3, 'completed', 'like',     'james'),  -- Reverse Cowgirl
   (35, 'completed', 'like',     'james'),  -- The Lap Dance
  (122, 'completed', 'favorite', 'james'),  -- Doggy Hands Cuffed Behind
  (103, 'completed', 'like',     'james'),  -- Seated Scissors with Remote Egg
  (102, 'removed',    null,      'james')   -- Rabbit Ears
on conflict (position_id) do update
  set status = excluded.status,
      rating = excluded.rating;

insert into public.lj_equipment (item, blocked) values
  ('door restraint',   true),
  ('suspension cuffs', true)
on conflict (item) do update set blocked = excluded.blocked;

-- ---------------------------------------------------------------------------
--  Cuisines
-- ---------------------------------------------------------------------------

insert into public.lj_cuisines (country, status, rank, decided_by) values
  ('Netherlands',           'ranked', 1, 'james'),
  ('Myanmar',               'ranked', 2, 'james'),
  ('Syrian Arab Republic',  'ranked', 3, 'james'),
  ('Australia',             'ranked', 4, 'james')
on conflict (country) do update
  set status = excluded.status,
      rank   = excluded.rank;

-- Spun but never placed.
insert into public.lj_cuisines (country, status, rank, decided_by)
values ('Argentina', 'pending', null, 'james')
on conflict (country) do nothing;

-- Nowhere in Melbourne serves these — parked off the wheel but not lost.
insert into public.lj_cuisines (country, status, rank, where_to_get, decided_by) values
  ('Belize',                            'unavailable', null, null, 'james'),
  ('Democratic Republic of the Congo',  'unavailable', null, null, 'james'),
  ('Tunisia',                           'unavailable', null, null, 'james'),
  ('Mali',                              'unavailable', null, null, 'james')
on conflict (country) do update
  set status = excluded.status,
      rank   = null;
