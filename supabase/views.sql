-- ============================================================
-- Fantasy Bake Off — views
-- ============================================================
-- Run after schema.sql, before rls.sql.
--
-- Scoring lives here and nowhere else. The dashboard, the leaderboard and the
-- player's own panel all read these, so they cannot disagree — which is exactly
-- the failure mode of computing the same rules in JavaScript in three places.
--
-- These views are the ONLY thing the browser's publishable key can read (see
-- rls.sql). They are deliberately left as security-definer — the Postgres
-- default — so that they can expose a filtered slice of tables the anon role
-- has no access to at all. That is the point, not an oversight: every WHERE
-- clause below is a permission boundary, so read them as such before editing.

-- ------------------------------------------------------------
-- Reference data
-- ------------------------------------------------------------
-- Nothing private in any of these, but they are views anyway so that the
-- browser's read surface is exactly one kind of thing: a granted view. One
-- mechanism means one place to audit, and no table is ever half-exposed by a
-- column grant somebody forgets about.

create or replace view v_seasons_public as
select id, name, year, episode_count, is_active
from seasons;

create or replace view v_leagues_public as
select id, season_id, name, slug, is_default
from leagues
where is_active;

create or replace view v_categories_public as
select key, label, points, sort_order, applies_to
from categories;

-- ------------------------------------------------------------
-- Players, without their codes
-- ------------------------------------------------------------
-- The dashboard needs names, colours and avatars. It must never see code_norm,
-- because a code IS the credential. Adding that column here would hand every
-- visitor the ability to log in as anyone.

create or replace view v_players_public as
select
  p.id,
  p.league_id,
  l.slug as league_slug,
  p.display_name,
  p.colour_hex,
  p.avatar_config,
  p.is_gm
from players p
join leagues l on l.id = p.league_id;

-- ------------------------------------------------------------
-- Public predictions — THE load-bearing filter
-- ------------------------------------------------------------
-- Predictions become visible to everyone the moment the episode goes ON AIR,
-- and not one second earlier. This WHERE clause is the whole of that guarantee:
-- hiding picks in the UI would be defeated by anyone opening devtools.
--
-- THE GATE IS `live_at`, NOT `deadline_at`, AND THAT IS THE WHOLE OF RULES
-- §2.5's NEW SHAPE. The deadline and the reveal used to be the same moment, so
-- anyone submitting in the 18:00–20:00 window did it with the entire league's
-- card in front of them — the warning §2.5 gave about VERY LATE applied just as
-- well to plain LATE, and nothing but that warning stood in the way. Splitting
-- them gives 18:00 one job and 20:00 the other:
--
--   18:00  picks close. Saving after this costs 2 points (v_penalties below).
--   20:00  the episode airs. The panel hard-locks AND everything goes public.
--
-- The useful consequence is structural rather than written down: the only
-- player who can ever submit having seen someone else's pick is one the GM
-- deliberately let through the door after 20:00, stamped VERY LATE. Everybody
-- else, on time or late, is guessing blind.
--
-- `live_at is not null` FAILS CLOSED. Episodes are seeded with no date (the
-- schedule isn't announced yet), and NULL <= now() is NULL, not false — but
-- relying on that is one refactor away from disaster. An episode with no air
-- time is one that cannot have aired, so its predictions stay private.
--
-- Both moments derive from air_date through schema.sql's trigger, so neither
-- depends on anybody pressing anything. That was NOT true when this gate was
-- first considered for live_at — see the long note on v_series_guesses_public,
-- which records why it was wrong then and right now.
--
-- Disallowed entries ARE included, flagged, so the prediction wall can show
-- them struck through. Every SCORING view below excludes them.

create or replace view v_public_predictions as
select
  en.player_id,
  en.episode_id,
  pr.category,
  pr.baker_id,
  en.lateness,
  en.is_disallowed,
  (en.confirmed_at is not null) as confirmed
from entries en
join predictions pr on pr.entry_id = en.id
join episodes    ep on ep.id = en.episode_id
where ep.live_at is not null
  and ep.live_at <= now();

-- ------------------------------------------------------------
-- Public top three — the SAME load-bearing filter, on episode 2
-- ------------------------------------------------------------
-- Who is in whose top three. Nothing granted said this before: v_series_bonus
-- carries points only and v_baker_stats a count per baker, so a Top Three board
-- had no way to name anyone.
--
-- The gate is episode 2's AIR TIME, and the two halves of that are worth
-- keeping apart, because they are now different moments:
--
--   the LOCK    18:00 on the Tuesday before episode 2 — RULES §5, which is
--               episode 2's own deadline, enforced in api/player.js
--   the REVEAL  20:00, when episode 2 goes on air — this view
--
-- They used to be one moment and one column. Splitting them follows
-- v_public_predictions for the same reason: a top three committed in the
-- 18:00–20:00 window should not be chosen by someone reading everybody else's
-- board. Deriving both from the episode rather than storing dates of their own
-- means they can never disagree with the week's picks, and they follow air_date
-- through schema.sql's trigger for free. `season_settings.top_picks_lock_at`
-- was the stored version of the lock and is now DEAD — see schema.sql.
--
-- `live_at is not null` FAILS CLOSED, exactly as above: no date set, no reveal.
-- Episode 2 has no air date yet, so that is today's live behaviour and an empty
-- board is the system working.
--
-- Carries baker_name for the same reason v_episode_results_public does: by the
-- time this board matters, some of these bakers are out of the tent and gone
-- from every cast list the browser can reach.
--
-- Like every other scoring view it holds rows for EVERY league playing the
-- season — seasons are shared by design — so callers filter by the player ids
-- from v_standings. Dropping that filter puts a stranger's three on the board.
--
-- THERE IS A THIRD GATE OF THIS SHAPE, further down: v_series_guesses_public,
-- on EPISODE 1's air time. Three secrets, three views, three episodes — and
-- each one fails closed on a null date.

create or replace view v_top_picks_public as
select
  tp.player_id,
  tp.baker_id,
  b.name   as baker_name,
  b.status as baker_status,
  tp.rank,
  tp.is_late,
  tp.is_disallowed
from top_picks tp
join bakers   b  on b.id = tp.baker_id
join episodes ep on ep.season_id = b.season_id and ep.number = 2
where ep.live_at is not null
  and ep.live_at <= now();

-- ------------------------------------------------------------
-- Per-prediction scoring
-- ------------------------------------------------------------
-- EXISTS, not a join to episode_results. With several correct bakers in one
-- category (two eliminations, three bingo hits) a join would multiply the row
-- and pay the player once per match; EXISTS pays once. RULES §3.
--
-- A voided category has no non-voided result rows, so is_correct is false for
-- everyone and the category quietly scores nothing — no special case needed.
-- A category with no results entered yet behaves identically, which is correct:
-- it has not been scored, not scored as zero.

create or replace view v_prediction_scores as
select
  en.player_id,
  en.episode_id,
  pr.category,
  pr.baker_id,
  c.points,
  exists (
    select 1
    from episode_results r
    where r.episode_id = en.episode_id
      and r.category   = pr.category
      and r.voided is false
      and r.baker_id   = pr.baker_id
  ) as is_correct
from entries     en
join predictions pr on pr.entry_id = en.id
join categories  c  on c.key = pr.category
where en.is_disallowed is false;

-- ------------------------------------------------------------
-- Penalties
-- ------------------------------------------------------------
-- TWO FAMILIES, and the difference between them is `category`.
--
-- THE PICK PENALTIES (RULES §2.3) — −1 for naming a Best Baker who left, −1 for
-- naming a Leaving Baker who took Star Baker. Both can fire in the same week.
-- Voided categories cannot trigger either, since `not voided` filters them out.
-- `category` says which pick of yours brought the penalty on, so the player
-- panel can put the −1 against that row and explain it in words.
--
-- THE DEADLINE PENALTY (RULES §2.5) — −2, and `category` is NULL, because it is
-- about the week rather than about any one pick. One rule with three wordings:
--
--   nothing live in by 18:00 costs you 2 points.
--
--   no_entry    you never submitted, or submitted an empty card, or the GM
--               disallowed what you did submit
--   late        your picks are in, stamped after 18:00
--   very_late   the same, through the GM's door after the episode started
--
-- The three are MUTUALLY EXCLUSIVE by construction — the `exists` in the late
-- arm is the exact negation of the `not exists` in the no_entry arm — so a
-- player can collect the −2 once per week and never twice. Getting that wrong
-- is the obvious way to break this: the floor for a week is −4 (both pick
-- penalties plus the deadline one), not −6.
--
-- All three are the same −2 on purpose. Equal magnitudes are what make a late
-- card strictly better than no card: once 18:00 has gone the fee is already
-- owed, so there is nothing further to lose by playing, and every incentive to.
-- A ladder would quietly tell a latecomer not to bother.
--
-- THE NULL CATEGORY IS LOAD-BEARING, not a shrug. Scorecard.jsx and
-- PredictionWall.jsx both find a pick's penalty with `p.category === c.key`, so
-- a null matches no category and can never light up a pick cell that did
-- nothing wrong. The panel renders these separately, against the week.
--
-- All of it lives here rather than in the browser for the reason the file
-- header states: the rule lives in SQL once. A browser deciding for itself when
-- a penalty applies would be a second implementation of a scoring rule, free to
-- drift from the one that pays out.
--
-- NOTE the column order: `category` is appended rather than sitting beside
-- `reason` where it belongs. CREATE OR REPLACE VIEW may only add columns to the
-- END of an existing view's list, and v_episode_scores depends on this one, so
-- re-ordering would mean dropping both and losing their grants.

create or replace view v_penalties as
select
  en.player_id,
  en.episode_id,
  'best_left'::text as reason,
  -1 as points,
  'best'::text as category
from entries     en
join predictions pr on pr.entry_id = en.id and pr.category = 'best'
where en.is_disallowed is false
  and exists (
    select 1 from episode_results r
    where r.episode_id = en.episode_id
      and r.category = 'leaving'
      and r.voided is false
      and r.baker_id = pr.baker_id
  )

union all

select
  en.player_id,
  en.episode_id,
  'leaving_starred'::text,
  -1,
  'leaving'::text
from entries     en
join predictions pr on pr.entry_id = en.id and pr.category = 'leaving'
where en.is_disallowed is false
  and exists (
    select 1 from episode_results r
    where r.episode_id = en.episode_id
      and r.category = 'best'
      and r.voided is false
      and r.baker_id = pr.baker_id
  )

union all

-- LATE — picks are in, but they were stamped after 18:00. The reason IS the
-- lateness, so 'late' and 'very_late' reach the panel as two different
-- sentences while costing the same 2 points.
--
-- api/player.js re-stamps `lateness` on EVERY save, which is what makes this
-- fire for an on-time entry edited after the deadline. That was free when LATE
-- was a label and is not now, so /play gates the edit behind a button that says
-- the price. The rule is here; the warning is there.
--
-- The `exists` is what keeps this arm and the no_entry arm from overlapping: an
-- entry with no predictions is not a late submission, it is an absent one, and
-- it is charged as such below.
select
  en.player_id,
  en.episode_id,
  en.lateness::text,
  -2,
  null::text
from entries en
where en.is_disallowed is false
  and en.lateness <> 'on_time'
  and exists (select 1 from predictions pr where pr.entry_id = en.id)

union all

-- NO ENTRY — nothing live in by the deadline at all. THE ONLY ARM THAT IS NOT
-- BUILT ON `entries`, and it cannot be: the player it charges has no entry row
-- to hang anything off. So the spine is the roster, and every player in a
-- league playing this season is measured against every episode of it.
--
-- `deadline_at is not null and <= now()` IS DOING HEAVY LIFTING. A season is
-- seeded with ten numbered episodes and no dates, so without it every player
-- would owe 20 points from the moment the season was created, for weeks that
-- have not happened. It also means the charge appears at 18:00 and not before,
-- and that a mis-set date un-charges itself the moment it is corrected.
--
-- THREE THINGS COUNT AS NOT SUBMITTING, and all three fall out of the one
-- `not exists` rather than being special-cased:
--
--   no entry row       you never opened the panel
--   an empty entry     you saved a card with nothing chosen (a real state —
--                      the GM's Entries tab counts `picks_made > 0` as "in")
--   a disallowed entry RULES §2.5 says it counts "as if it were never made",
--                      so it is not made, so it is not in. Deliberate: the
--                      alternative makes Disallow more lenient than being late.
--
-- v_episode_scores' spine has a matching third arm, because a player charged
-- here has no entry and no guess and would otherwise have no row for the week
-- to carry the points.
select
  p.id,
  ep.id,
  'no_entry'::text,
  -2,
  null::text
from players  p
join leagues  l  on l.id = p.league_id
join episodes ep on ep.season_id = l.season_id
where ep.deadline_at is not null
  and ep.deadline_at <= now()
  and not exists (
    select 1
    from entries     en
    join predictions pr on pr.entry_id = en.id
    where en.player_id  = p.id
      and en.episode_id = ep.id
      and en.is_disallowed is false
  );

-- ------------------------------------------------------------
-- The bake guess — scoring
-- ------------------------------------------------------------
-- RULES §6, TECH_PLAN §14. Two bakes per player, named once before episode 1.
-- The GM ticks a key when it comes up; this view works out what that is worth.
--
--   sole holder      +5
--   exactly two      +2 each
--   three or more     0
--   never came up     0
--
-- The GM's tick RECORDS A FACT — "madeleine came up in episode 3" — exactly as
-- episode_results does, and the tiers are applied here. That is why this design
-- needs no manual-points column despite being described as "manual": the §2
-- boundary holds with no exception, and smoke_test.sql can assert the tiers.
--
-- HOLDERS ARE COUNTED PER LEAGUE, NOT PER SEASON, and that is a decision rather
-- than an accident. Seasons are shared by every league playing them
-- (TECH_PLAN §2), so a season-wide count would let a stranger in another league
-- — someone the player has never met and is not competing against — quietly
-- take their +5 away and turn it into +2. Points belong to a league because the
-- leaderboard does. It is the opposite call from v_baker_stats, whose
-- prediction counts ARE season-wide (TECH_PLAN Still-open #10), and the
-- difference is that those are a stat and these are points.
--
-- Disallowed guesses are excluded HERE, before the count. That second half
-- matters as much as the first: a disallowed guess still counted towards the
-- tier would let one struck-out entry silently drop everybody else from +5
-- to +2, which is the opposite of "as if it were never made" (RULES §2.5).
--
-- NOT GRANTED, and it must not be — see rls.sql. It carries player_id beside
-- guess_key with no gate of its own, so granting it would publish everyone's
-- guesses from the moment they were typed. The gate lives in
-- v_series_guesses_public below, which is built on this one.

create or replace view v_guess_scores as
with held as (
  select
    pl.league_id,
    g.guess_key,
    count(*) as holders
  from series_guesses g
  join players pl on pl.id = g.player_id
  where g.is_disallowed is false
  group by pl.league_id, g.guess_key
)
select
  g.player_id,
  pl.league_id,
  l.season_id,
  g.slot,
  g.guess_text,
  g.guess_key,
  h.holders,
  -- NULL until the GM ticks it. Every caller reads this as "the episode this
  -- guess paid in", so it is also the flag for whether it has landed at all.
  gh.episode_id,
  case
    when gh.episode_id is null then 0
    when h.holders = 1 then 5
    when h.holders = 2 then 2
    else 0
  end as points
from series_guesses g
join players pl on pl.id = g.player_id
join leagues l  on l.id = pl.league_id
join held    h  on h.league_id = pl.league_id and h.guess_key = g.guess_key
left join guess_hits gh on gh.season_id = l.season_id and gh.guess_key = g.guess_key
where g.is_disallowed is false;

-- ------------------------------------------------------------
-- Public bake guesses — the load-bearing filter a THIRD time, on episode 1
-- ------------------------------------------------------------
-- Exactly the same shape as v_top_picks_public, one episode earlier: the bake
-- guesses lock at **episode 1's deadline** and are revealed when **episode 1
-- goes on air**, the way the top three lock and reveal around episode 2.
--
-- `live_at is not null` FAILS CLOSED, as everywhere else. Episode 1 has no air
-- date until the schedule is announced, so an empty board is this view working
-- rather than this view broken.
--
-- THIS GATED ON `live_at` ONCE BEFORE AND IT WAS A BUG THEN — worth reading
-- before anybody "fixes" it back, because the history inverts. `live_at` used
-- to be stamped only by the GM's Go live button and cleared by Take it back,
-- and Take it back was for a while the ONLY route from live to complete — so
-- every episode reached "over" with a null live_at and this board emptied the
-- moment the episode finished. A gate hanging off a button somebody has to
-- remember to press is not a gate, and it was moved to `deadline_at` for that
-- reason and no other.
--
-- That objection is dead. `live_at` is now DERIVED from air_date at 20:00 by
-- schema.sql's trigger, exactly as `deadline_at` is derived at 18:00; Go live
-- is gone and no button touches either. So the column that was always the more
-- precise answer to "has episode 1 aired?" is now also a safe one, and the
-- reveal has moved back onto it — this time deliberately, to put the lock and
-- the reveal at two different moments (see v_public_predictions).
--
-- WHAT THIS BUYS BACK: the GM gets the private window again. Between the lock
-- and the episode airing they can see the list and unify the wordings before
-- anybody else reads them, which is what RULES §6 describes and what the
-- deadline-gated version had quietly taken away. It was survivable either way —
-- this view publishes `guess_text`, what the player typed, which nothing ever
-- edits, and never `guess_key` as the thing on display, so unifying moves
-- points rather than words — but private is how §6 says it works.
--
-- Disallowed guesses ARE included, flagged, so the board can show them struck
-- through — the same choice v_public_predictions makes, for the same reason.
-- They are already out of `holders` and `points`, which come from
-- v_guess_scores and arrive NULL and 0 for them.
--
-- Like every other view here it holds rows for EVERY league playing the season,
-- so callers filter by the player ids from v_standings.

create or replace view v_series_guesses_public as
select
  g.player_id,
  g.slot,
  g.guess_text,
  g.guess_key,
  g.is_late,
  g.is_disallowed,
  gs.holders,
  gs.episode_id as hit_episode_id,
  he.number     as hit_episode_number,
  coalesce(gs.points, 0) as points
from series_guesses g
join players  pl on pl.id = g.player_id
join leagues  l  on l.id = pl.league_id
join episodes e1 on e1.season_id = l.season_id and e1.number = 1
left join v_guess_scores gs
       on gs.player_id = g.player_id and gs.guess_key = g.guess_key
left join episodes he on he.id = gs.episode_id
where e1.live_at is not null
  and e1.live_at <= now();

-- ------------------------------------------------------------
-- Per-episode scores
-- ------------------------------------------------------------
-- THE SPINE IS THE GUEST LIST: a (player, episode) pair that is not on it has
-- no row here, and so is absent from the chart, from the scorecard and from
-- v_standings' sum. Everything else in this view LEFT JOINs onto it. It has
-- grown an arm each time something could move a player's score without their
-- having made picks that week, and the three read in that order:
--
--   entries     a player who entered and got everything wrong appears with 0,
--               which is not the same as a player who did not enter
--   guesses     a bake guess pays in the week it COMES UP, which may be a week
--               its owner made no picks in (RULES §6). An entries-only spine
--               had nowhere to put those points and dropped them silently
--   penalties   a player charged for not submitting at all (RULES §2.5) has no
--               entry and no guess, so this is the only thing that gives their
--               −2 a week to land in
--
-- The penalty arm is written against `pens` rather than against the no_entry
-- reason specifically, which is the useful generalisation: ANY penalty is
-- guaranteed a row to be carried by, including whatever the fourth one turns
-- out to be.
--
-- NOTE WHAT THAT REVERSES. A guess that came up but was too popular to score
-- pulls in no row, deliberately: a 0-point row for somebody who sat the week
-- out would put them on the chart for an episode they were never in. The
-- penalty arm does exactly that and is right to — the difference is that 0 for
-- an absentee is noise, and −2 for an absentee is the news. They did not sit
-- the week out; they missed it, and it cost them.
--
-- This is also why guess points get an episode at all, where the top-three
-- bonus cannot: v_series_bonus carries no episode, so it can never step the
-- chart or produce movement, but a guess hits in a specific week and does both,
-- on the night.

create or replace view v_episode_scores as
with picks as (
  select
    player_id,
    episode_id,
    sum(case when is_correct then points else 0 end) as pick_points,
    count(*) filter (where is_correct)               as correct_count,
    count(*)                                         as picks_made
  from v_prediction_scores
  group by player_id, episode_id
),
pens as (
  select
    player_id,
    episode_id,
    sum(points) as penalty_points,
    -- What each penalty was for, so the panel can say it in words rather than
    -- working it out — the browser only reads this; deciding when a penalty
    -- applies stays in v_penalties.
    --
    -- A pick penalty carries the category it came from, and goes against that
    -- row on the card. The deadline penalty carries a NULL category, because it
    -- is about the week, and the panel renders it against the week instead. The
    -- reader tells them apart by that null and nothing else, so it has to
    -- survive the trip: `order by category` sorts nulls last, which puts the
    -- week's penalty at the end of the array where the panel expects it.
    jsonb_agg(
      jsonb_build_object('category', category, 'reason', reason, 'points', points)
      order by category
    ) as penalties
  from v_penalties
  group by player_id, episode_id
),
guesses as (
  select
    player_id,
    episode_id,
    sum(points) as guess_points
  from v_guess_scores
  where episode_id is not null
  group by player_id, episode_id
),
live_entries as (
  select * from entries where is_disallowed is false
),
spine as (
  select player_id, episode_id from live_entries
  union
  select player_id, episode_id from guesses where guess_points <> 0
  union
  select player_id, episode_id from pens
)
select
  sp.player_id,
  sp.episode_id,
  ep.number as episode_number,
  coalesce(pk.pick_points, 0)
    + coalesce(pn.penalty_points, 0)
    + coalesce(gu.guess_points, 0) as points,
  coalesce(pk.pick_points, 0)    as pick_points,
  coalesce(pn.penalty_points, 0) as penalty_points,
  coalesce(pk.correct_count, 0)  as correct_count,
  coalesce(pk.picks_made, 0)     as picks_made,
  -- NULL for a row with no entry behind it — one that exists only because a
  -- guess paid, or because the player is being charged for not submitting.
  -- There is no submission, so there is nothing to be late. Every reader treats
  -- this as a flag rather than a value ('late' / 'very_late'), so null reads as
  -- "nothing to flag" — and for the no_entry case the `penalties` array below
  -- is what says why the week is negative.
  en.lateness,
  (en.confirmed_at is not null)  as confirmed,
  -- Appended, not placed beside penalty_points where it belongs: CREATE OR
  -- REPLACE VIEW may only add columns to the end, and v_standings depends on
  -- this view, so re-ordering would mean dropping both and re-granting them.
  coalesce(pn.penalties, '[]'::jsonb) as penalties,
  -- Appended for the same reason, and it is a NUMBER ONLY — deliberately not
  -- the guess itself. This view is granted to anon with no gate of its own, so
  -- carrying guess_key or guess_text here would be a second way to read the
  -- guesses, on a different clock from v_series_guesses_public's. One secret,
  -- one gate. The words reach the dashboard through that view and reach a
  -- player's own panel through /api/player, which is authenticated.
  coalesce(gu.guess_points, 0) as guess_points
from spine sp
join episodes ep on ep.id = sp.episode_id
left join live_entries en on en.player_id = sp.player_id and en.episode_id = sp.episode_id
left join picks   pk on pk.player_id = sp.player_id and pk.episode_id = sp.episode_id
left join pens    pn on pn.player_id = sp.player_id and pn.episode_id = sp.episode_id
left join guesses gu on gu.player_id = sp.player_id and gu.episode_id = sp.episode_id;

-- ------------------------------------------------------------
-- End-of-series bonuses
-- ------------------------------------------------------------
-- +3 for each of your three who reaches the final, +6 if the winner is one of
-- them. 'winner' counts as a finalist too, so a perfect set is 3+3+3+6 = 15.
-- The +3s become visible as soon as bakers are marked 'finalist' (after the
-- semi-final); the +6 when one is marked 'winner'. RULES §5.

create or replace view v_series_bonus as
select
  tp.player_id,
  count(*) filter (where b.status in ('finalist','winner')) * 3
    + case when count(*) filter (where b.status = 'winner') > 0 then 6 else 0 end
    as points,
  count(*) filter (where b.status in ('finalist','winner')) as finalists,
  (count(*) filter (where b.status = 'winner') > 0)         as has_winner
from top_picks tp
join bakers b on b.id = tp.baker_id
where tp.is_disallowed is false
group by tp.player_id;

-- ------------------------------------------------------------
-- Standings
-- ------------------------------------------------------------
-- The leaderboard. Ranked with rank(), so ties share a position — RULES §7's
-- tiebreak is applied by a human at the end of the series, not here.

create or replace view v_standings as
with ep as (
  select player_id,
         sum(points)        as episode_points,
         sum(correct_count) as correct_total
  from v_episode_scores
  group by player_id
)
select
  p.id            as player_id,
  p.league_id,
  l.slug          as league_slug,
  p.display_name,
  p.colour_hex,
  p.avatar_config,
  coalesce(ep.episode_points, 0) as episode_points,
  coalesce(sb.points, 0)         as bonus_points,
  coalesce(ep.episode_points, 0) + coalesce(sb.points, 0) as total_points,
  coalesce(ep.correct_total, 0)  as correct_total,
  rank() over (
    partition by p.league_id
    order by coalesce(ep.episode_points, 0) + coalesce(sb.points, 0) desc
  ) as position
from players p
join leagues l on l.id = p.league_id
left join ep on ep.player_id = p.id
left join v_series_bonus sb on sb.player_id = p.id;

-- ------------------------------------------------------------
-- Baker stats — feeds /bakers
-- ------------------------------------------------------------
-- Prediction-derived columns read v_public_predictions, NOT predictions. Going
-- to the base table would leak the current week's picks through an aggregate
-- before the deadline — "eleven people think Priya is going" is exactly the
-- information the deadline exists to protect.

create or replace view v_baker_stats as
select
  b.id as baker_id,
  b.season_id,
  b.name,
  b.photo_url,
  b.bio_line,
  b.status,
  b.eliminated_episode,
  b.sort_order,
  (select count(*) from episode_results r
     where r.baker_id = b.id and r.category = 'best'      and not r.voided) as star_bakers,
  (select count(*) from episode_results r
     where r.baker_id = b.id and r.category = 'technical' and not r.voided) as technical_wins,
  (select count(*) from episode_results r
     where r.baker_id = b.id and r.category = 'handshake' and not r.voided) as handshakes,
  (select count(*) from episode_results r
     where r.baker_id = b.id and r.category = 'bingo'     and not r.voided) as bingo_hits,
  (select count(*) from v_public_predictions vp
     where vp.baker_id = b.id and vp.category = 'best'    and not vp.is_disallowed) as picked_best,
  (select count(*) from v_public_predictions vp
     where vp.baker_id = b.id and vp.category = 'leaving' and not vp.is_disallowed) as picked_leaving,
  -- Reads v_top_picks_public, NOT top_picks. Going to the base table leaked the
  -- top three before the reveal: this view is granted to anon, so "seven people
  -- are riding on Priya" was readable from the moment picks opened, which is
  -- precisely what RULES §5's episode-2 reveal exists to prevent. Same bug as
  -- the header warns about for predictions, and the same fix.
  (select count(*) from v_top_picks_public tp
     where tp.baker_id = b.id and not tp.is_disallowed) as in_top_threes,
  -- Episodes completed before they left; still-active bakers count every
  -- completed episode. The "written off N times and still here" stat pairs
  -- this with picked_leaving.
  (select count(*) from episodes e
     where e.season_id = b.season_id
       and e.status = 'complete'
       and (b.eliminated_episode is null or e.number < b.eliminated_episode)
  ) as weeks_survived
from bakers b;

-- ------------------------------------------------------------
-- Episodes, safe for the browser
-- ------------------------------------------------------------
-- Everything on episodes is publishable — the bingo prompt is meant to be read
-- before the deadline. This view exists so the dashboard has one obvious place
-- to read from, and so a future private column does not leak by default.

create or replace view v_episodes_public as
select
  e.id, e.season_id, e.number, e.theme, e.air_date,
  e.deadline_at, e.live_at, e.bingo_prompt, e.status, e.is_final,
  -- "Has everyone's card been revealed?", which since the lock and the reveal
  -- became two moments is NOT "is it past the deadline?" any more. The name is
  -- now a little wrong and is kept anyway: create or replace view cannot rename
  -- a column, and renaming means dropping this view and re-granting it. Read it
  -- as `predictions_revealed`. It must stay in step with
  -- v_public_predictions' WHERE clause — that view is the actual boundary, and
  -- this is only the flag the UI reads to know what it is about to be shown.
  (e.live_at is not null and e.live_at <= now()) as predictions_public,
  -- On air right now: past its lock time and not yet marked complete. Appended
  -- rather than placed beside status, because CREATE OR REPLACE VIEW may only
  -- add columns to the end.
  --
  -- COMPUTED, NOT STORED, and that is the point. `status = 'live'` used to
  -- carry this and was set by a button the GM pressed as the episode started —
  -- so a forgotten tap left the dashboard polling every 30s through the one
  -- hour it exists for. A comparison cannot be forgotten. It is worked out here
  -- rather than in the browser for the same reason `predictions_public` is: a
  -- phone with a wrong clock should not decide what "now" means.
  (e.live_at is not null and e.live_at <= now() and e.status <> 'complete') as is_live
from episodes e;

-- ------------------------------------------------------------
-- Results, safe for the browser
-- ------------------------------------------------------------
-- What puts a tick or a cross on the player panel and the dashboard.
--
-- NO DEADLINE GATE, deliberately — unlike v_public_predictions. A result is a
-- fact about a broadcast episode, not a pick, and there is nothing here to
-- protect: a result exists only once the GM has typed what happened, which is
-- during the episode, long after the deadline. Do not copy the gate in from
-- v_public_predictions by reflex; the smoke test asserts its absence.
--
-- THREE STATES HAVE TO SURVIVE THE TRIP, and the difference between the first
-- two is load-bearing (RULES §3, DESIGN §7):
--
--   not decided yet   no row at all               shown plainly blank
--   Nobody won it     one row, voided, no baker   shown hatched, struck out
--   a winner          a row with a baker          shown with a tick or a cross
--
-- Hence `voided` is exposed, and the join to bakers is a LEFT join. An inner
-- join would drop every Nobody row, silently collapsing "Nobody won it" into
-- "not decided yet" — the exact mistake schema.sql's comment on
-- episode_results warns against, and invisible until an episode where it
-- matters.
--
-- baker_name rides along because the browser cannot look it up. The leaving
-- result names a baker whom api/gm.js has, by the time that result lands,
-- already marked eliminated and dropped from the panel's cast list — so the
-- player who called it correctly would see a blank where their best pick was.
-- Names are public regardless: v_baker_stats publishes every one.
--
-- season_id rides along so the dashboard's series recap reads a whole season in
-- one query rather than assembling an episode_id in-list. It is already public
-- through v_episodes_public.
--
-- Deliberately NOT exposed: `id` and `entered_at`. Nothing needs them —
-- (episode, category, baker) is already unique — and the second is a record of
-- when the GM happened to be typing.

create or replace view v_episode_results_public as
select
  r.episode_id,
  e.season_id,
  r.category,
  r.baker_id,
  b.name as baker_name,
  r.voided
from episode_results r
join      episodes e on e.id = r.episode_id
left join bakers   b on b.id = r.baker_id;
