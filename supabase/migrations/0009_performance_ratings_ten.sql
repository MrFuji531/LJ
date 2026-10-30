-- Widen live performance scores without changing existing ratings.
begin;
alter table public.lj_performances
  alter column score_james type numeric(3,1),
  alter column score_lee type numeric(3,1),
  drop constraint if exists lj_performances_score_james_check,
  drop constraint if exists lj_performances_score_lee_check;
alter table public.lj_performances
  add constraint lj_performances_score_james_check check (score_james between 0 and 10),
  add constraint lj_performances_score_lee_check check (score_lee between 0 and 10);
commit;
