-- ============================================================
-- Placeholder bakers — for trying the app before the cast is announced
-- ============================================================
-- Twelve stand-ins so /play has something to pick from. Optional, and entirely
-- disposable.
--
-- When the real cast is announced, either rename these in the GM panel (their
-- ids stay put, so any picks made against them survive) or delete them:
--
--   delete from bakers where name like 'Baker %';
--
-- Deleting cascades to predictions and top_picks, which is what you want for
-- test data and NOT what you want mid-series. There is no undo.

insert into bakers (season_id, name, bio_line, sort_order)
select s.id, v.name, v.bio_line, v.sort_order
from seasons s
cross join (values
  ('Baker One',    'Bakes to a spreadsheet.',            1),
  ('Baker Two',    'Has never met a spice they dislike.', 2),
  ('Baker Three',  'Laminates everything.',              3),
  ('Baker Four',   'Chaotic, occasionally brilliant.',   4),
  ('Baker Five',   'Grandmother''s recipes only.',       5),
  ('Baker Six',    'Structural engineer by trade.',      6),
  ('Baker Seven',  'Chronically over-ambitious.',        7),
  ('Baker Eight',  'Quietly excellent at bread.',        8),
  ('Baker Nine',   'Decorates like a maniac.',           9),
  ('Baker Ten',    'Timings are a suggestion.',         10),
  ('Baker Eleven', 'Owns forty piping nozzles.',        11),
  ('Baker Twelve', 'Suspiciously calm.',                12)
) as v(name, bio_line, sort_order)
where s.name = 'GBBO 2026'
on conflict (season_id, name) do nothing;

select count(*) as bakers_in_the_tent from bakers;
