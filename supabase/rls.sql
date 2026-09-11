-- ============================================================
-- Fantasy Bake Off — row-level security and grants
-- ============================================================
-- Run after views.sql, before seed.sql.
--
-- The model, in one sentence: the browser can read a handful of views and
-- NOTHING else, and cannot write anywhere at all.
--
-- Three things this protects, in order of how badly they'd hurt:
--   1. players.code_norm — a code IS the credential. Anyone who can read the
--      table can log in as everybody.
--   2. predictions before their deadline — the entire point of the game.
--   3. every write path — all of them go through service-role functions in
--      api/, which is where the rules (lateness, locks, the GM password) live.
--      A write the browser could make is a rule the browser could skip.

-- ------------------------------------------------------------
-- RLS on, with no policies
-- ------------------------------------------------------------
-- Enabling RLS without policies denies everything to anon and authenticated.
-- The service role bypasses RLS entirely, which is how api/ still works.
--
-- This is belt and braces alongside the REVOKEs below: either alone would do,
-- and the failure modes differ — a stray GRANT is survived by RLS, and RLS
-- accidentally disabled on one table is survived by the missing GRANT.

alter table seasons         enable row level security;
alter table bakers          enable row level security;
alter table leagues         enable row level security;
alter table players         enable row level security;
alter table categories      enable row level security;
alter table episodes        enable row level security;
alter table episode_results enable row level security;
alter table entries         enable row level security;
alter table predictions     enable row level security;
alter table top_picks       enable row level security;
alter table series_guesses  enable row level security;
alter table guess_hits      enable row level security;
alter table season_settings enable row level security;

-- ------------------------------------------------------------
-- No direct table access for the browser
-- ------------------------------------------------------------

revoke all on seasons,
              bakers,
              leagues,
              players,
              categories,
              episodes,
              episode_results,
              entries,
              predictions,
              top_picks,
              series_guesses,
              guess_hits,
              season_settings
  from anon, authenticated;

-- ------------------------------------------------------------
-- The browser's entire read surface
-- ------------------------------------------------------------
-- These views are security-definer (the Postgres default), so they read their
-- underlying tables as the VIEW OWNER rather than as the caller. The owner is
-- `postgres`, which also owns the tables, and a table's owner is exempt from
-- its own RLS — so the views see everything while the caller sees nothing
-- directly. That is the mechanism, and it is deliberate: it is what lets a view
-- expose a filtered slice of a table the browser cannot touch at all.
--
-- The consequence: adding a column or relaxing a WHERE clause in views.sql
-- publishes data to the internet. Treat that file as a permission boundary.
--
-- Supabase's linter flags security-definer views by design. This is the
-- documented exception, not something to "fix" by flipping security_invoker on
-- — that would make every view return nothing, because anon has no table
-- rights at all. (If the tables are ever set to FORCE ROW LEVEL SECURITY, the
-- owner exemption goes away and every one of these views goes empty. Don't.)
--
-- The browser's read surface is exactly this list. It is all views, on purpose:
-- one mechanism, one place to audit, and no table left half-exposed by a
-- column grant nobody remembers.

grant select on v_seasons_public     to anon, authenticated;
grant select on v_leagues_public     to anon, authenticated;
grant select on v_categories_public  to anon, authenticated;
grant select on v_players_public     to anon, authenticated;
grant select on v_public_predictions to anon, authenticated;
grant select on v_top_picks_public   to anon, authenticated;
grant select on v_series_guesses_public to anon, authenticated;
grant select on v_episode_scores     to anon, authenticated;
grant select on v_series_bonus       to anon, authenticated;
grant select on v_standings          to anon, authenticated;
grant select on v_baker_stats        to anon, authenticated;
grant select on v_episodes_public    to anon, authenticated;
grant select on v_episode_results_public to anon, authenticated;

-- Deliberately NOT granted, and worth stating so nobody adds them later by
-- reflex: players (codes), entries, predictions, top_picks (private until
-- episode 2 AIRS — reached via v_top_picks_public, which applies that gate),
-- series_guesses and guess_hits (private until episode 1 airs — reached via
-- v_series_guesses_public, which applies THAT gate),
-- episode_results (reached via v_baker_stats and v_episode_results_public,
-- which expose what happened without the row ids or the GM's typing times),
-- season_settings.
--
-- v_prediction_scores, v_penalties and v_guess_scores are also not granted:
-- they are internal steps, computed from entries and series_guesses with no
-- gate of their own. The first two are safe only because the views that use
-- them aggregate away the individual picks; granting either would leak this
-- week's predictions. v_guess_scores is the starker case — it carries
-- guess_key beside player_id, so granting it would publish everyone's guesses
-- from the moment they were typed, which is exactly what the reveal exists to
-- prevent. v_episode_scores takes a NUMBER from it and nothing else.
