-- ============================================================
-- The real cast — GBBO 2026 (series 17), announced September 2026
-- ============================================================
-- Renames the twelve placeholders from placeholder_bakers.sql in place and
-- gives them a bio and a photo. It UPDATES rather than deleting and reinserting
-- so that **the ids stay put** — any picks already made against a placeholder
-- survive the rename, which is what TECH_PLAN's open question #2 asks for.
--
-- Keyed on `sort_order`, not on the placeholder names, so it is idempotent:
-- re-run it as often as you like to fix a bio or swap a photo URL. Running it
-- twice changes nothing the second time.
--
-- Safe to paste on its own. It touches no view, no grant and no policy, so
-- there is nothing to re-paste afterwards and smoke_test.sql is unaffected.
--
-- Names, regions and photos: https://thegreatbritishbakeoff.co.uk/meet-the-class-of-2026/
-- The bio lines are ours, not theirs — one wry line each, in the register the
-- placeholders were written in. Edit them freely; nothing depends on the words.
--
-- Sorted alphabetically into sort_order 1-12. That is the cast-list order on
-- /bakers before anyone has baked; after that the page sorts by status first.

update bakers b
set    name      = v.name,
       bio_line  = v.bio_line,
       photo_url = v.photo_url
from   (values
  ( 1, 'Clara',   'Portuguese, polyglot, and never once still.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/CLARA-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  ( 2, 'Connie',  'Known to everyone as the Cake Lady.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/CONNIE-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  ( 3, 'Danni',   'Forages the hedgerow, then bakes it.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/DANNI-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  ( 4, 'Gabe',    'Self-styled daddy of Birmingham drag.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/GABE-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  ( 5, 'Gary',    'Impeccable presentation, bold flavours.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/GARY-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  ( 6, 'Mo',      'Chaotic, random, and reading law.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/MO-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  ( 7, 'Molly',   'Twenty-five years of a grandmother''s recipes.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/MOLLY-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  ( 8, 'Moyin',   'Athletics, exams, and Nigerian flavours.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/MOYIN-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  ( 9, 'Nikki',   'A colourful character with a colourful style.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/NIKKI-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  (10, 'Shannon', 'Wants to bring a little forest indoors.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/SHANNON-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  (11, 'Tom',     'Self-proclaimed northern diva.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/TOM-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg'),
  (12, 'Yannis',  'Brings pastry to the neonatal ward.',
       'https://thegreatbritishbakeoff.co.uk/wp-content/uploads/2026/09/YANNIS-Anno-CLEAN_GBBO_S17_PreTX_1x1-450x450.jpg')
) as v(sort_order, name, bio_line, photo_url),
       seasons s
where  s.name = 'GBBO 2026'
  and  b.season_id = s.id
  and  b.sort_order = v.sort_order;

-- Expect twelve rows, all named, all with a photo. A row still called
-- "Baker Something" means its sort_order did not match — check for a baker
-- added by hand in the GM panel, which takes max(sort_order) + 1.
--
-- Every column here is qualified because `bakers` and `seasons` BOTH have a
-- `name`: a bare one is ambiguous, and Postgres rejects the whole script over
-- it — including the update above, which is otherwise fine.
select b.sort_order, b.name, b.bio_line, b.photo_url is not null as has_photo, b.status
from   bakers b
join   seasons s on s.id = b.season_id
where  s.name = 'GBBO 2026'
order  by b.sort_order;
