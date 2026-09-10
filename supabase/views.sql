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
-- Predictions become visible to everyone the moment their deadline passes, and
-- not one second earlier. This WHERE clause is the whole of that guarantee:
-- hiding picks in the UI would be defeated by anyone opening devtools.
--
-- `deadline_at is not null` FAILS CLOSED. Episodes are seeded with no date
-- (the schedule isn't announced yet), and NULL <= now() is NULL, not false —
-- but relying on that is one refactor away from disaster. An episode with no
-- deadline is one nobody can be late for, so its predictions stay private.
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
where ep.deadline_at is not null
  and ep.deadline_at <= now();

-- ------------------------------------------------------------
-- Public top three — the SAME load-bearing filter, on episode 2
-- ------------------------------------------------------------
-- Who is in whose top three. Nothing granted said this before: v_series_bonus
-- carries points only and v_baker_stats a count per baker, so a Top Three board
-- had no way to name anyone.
--
-- The gate is episode 2's deadline, and that is not a coincidence — RULES §5
-- locks the top three at 18:00 on the Tuesday before episode 2, which IS
-- episode 2's deadline. Deriving it from the episode rather than storing a
-- second date means the two can never disagree, and it follows air_date through
-- schema.sql's trigger for free. `season_settings.top_picks_lock_at` was the
-- stored version of this and is now DEAD — see the note on it in schema.sql.
--
-- `deadline_at is not null` FAILS CLOSED, exactly as above: no date set, no
-- reveal. Episode 2 has no air date yet, so that is today's live behaviour and
-- an empty board is the system working.
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
-- on EPISODE 1's deadline. Three secrets, three views, three episodes — and
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
where ep.deadline_at is not null
  and ep.deadline_at <= now();

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
-- −1 for naming a Best Baker who left, −1 for naming a Leaving Baker who took
-- Star Baker. Both can fire in the same week, so the floor is −2.
-- Voided categories cannot trigger either, since `not voided` filters them out.
--
-- `category` says which pick of yours brought the penalty on, so the player
-- panel can put the −1 against that row and explain it in words. It is here,
-- and not worked out in the browser, for the reason the header states: the rule
-- lives in SQL once. A browser deciding for itself when a penalty applies would
-- be a second implementation of a scoring rule, free to drift.
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
-- guesses lock at **episode 1's deadline** and are revealed at the same moment,
-- the way the top three lock and reveal at episode 2's.
--
-- `deadline_at is not null` FAILS CLOSED, as everywhere else. Episode 1 has no
-- air date until the schedule is announced, so an empty board is this view
-- working rather than this view broken.
--
-- THIS GATED ON `live_at` FIRST, AND THAT WAS A BUG — worth knowing, because
-- `live_at` still looks like the more precise answer to "has episode 1 aired?"
-- It is stamped only by the GM's Go live button and cleared by Take it back,
-- and until this was fixed Take it back was the ONLY route from live to
-- complete — so every episode reached "over" with a null live_at and the board
-- emptied the moment the episode finished. A gate hanging off a button somebody
-- has to remember to press is not a gate. `deadline_at` follows `air_date`
-- through schema.sql's trigger and no button touches it.
--
-- WHAT THIS COSTS: the GM used to get the list first, in the gap between the
-- lock and the episode airing, and unify the wordings before anybody read them.
-- Now everyone sees it at once. That is survivable because this view publishes
-- `guess_text` — what the player typed, which nothing ever edits — and never
-- `guess_key` as the thing on display. Unifying moves points, not words, and no
-- points can land until a guess is ticked, which is during episode 1 at the
-- earliest. So the GM still has the same few hours; they are just not private.
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
where e1.deadline_at is not null
  and e1.deadline_at <= now();

-- ------------------------------------------------------------
-- Per-episode scores
-- ------------------------------------------------------------
-- One row per player per episode they entered. Entries are the spine, so a
-- player who entered and got everything wrong appears with 0 — distinct from a
-- player who never entered at all, who does not appear. The dashboard needs
-- that difference to draw a flat line rather than a gap.
--
-- SINCE THE BAKE GUESS, ENTRIES ARE NOT THE WHOLE SPINE. A guess pays in the
-- week it comes up, and that week may be one the player made no picks in — so
-- an entries-only spine would have nowhere to put the points and would silently
-- drop them. The spine is therefore entries UNION the weeks a guess paid in.
--
-- Only a guess that actually PAID pulls in a new row. A guess that came up but
-- was too popular to score has nothing to deliver, and a 0-point row for
-- somebody who sat that week out would put them on the chart for an episode
-- they were never in.
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
    -- Which picks brought the penalties on, so the panel can put each −1
    -- against the row that earned it and say why in words. The browser only
    -- reads this; deciding when a penalty applies stays in v_penalties.
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
  -- NULL for a row that exists only because a guess paid: there is no entry, so
  -- there is no submission to be late. Every reader treats it as a flag rather
  -- than a value ('late' / 'very_late'), so null reads as "nothing to flag".
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
  (e.deadline_at is not null and e.deadline_at <= now()) as predictions_public,
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
