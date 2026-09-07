-- ============================================================
-- Fantasy Bake Off — smoke test
-- ============================================================
-- Paste the whole file into the Supabase SQL editor and run it.
--
--   a row reading "SMOKE TEST PASSED"  → scoring and the deadline gate behave.
--   an ERROR                           → the message names the rule that broke.
--
-- The verdict is a SELECT after the rollback, deliberately. RAISE NOTICE does
-- not surface in the Supabase SQL editor, so a passing run using it looks
-- identical to a run that did nothing — which is the worst possible failure
-- mode for a test. A failed assertion aborts the script, so the final SELECT is
-- reached only when everything held.
--
-- Everything happens inside a transaction that ROLLS BACK, so it touches no
-- real data and can be run against the live database at any time. Re-run it
-- after any change to views.sql — that file is both the scoring engine and a
-- permission boundary, and neither has a UI that would show you it broke.

begin;

-- Without this, a database with plpgsql.check_asserts off would skip every
-- assertion below and pass vacuously.
set local plpgsql.check_asserts = on;

do $$
declare
  v_season uuid;
  v_league uuid;
  baker_a uuid; baker_b uuid; baker_c uuid; baker_d uuid;
  ep1 uuid; ep2 uuid; ep3 uuid;
  p1 uuid; p2 uuid; p3 uuid;
  e1 uuid; e2 uuid; e3 uuid;
  got int;
  got_bool boolean;
begin
  -- ---- fixtures -------------------------------------------------------

  insert into seasons (name, year, episode_count)
    values ('SMOKE TEST SEASON', 1999, 10) returning id into v_season;

  insert into leagues (season_id, name, slug)
    values (v_season, 'Smoke Test League', 'smoke-test-league') returning id into v_league;

  insert into bakers (season_id, name) values (v_season, 'Baker A') returning id into baker_a;
  insert into bakers (season_id, name) values (v_season, 'Baker B') returning id into baker_b;
  insert into bakers (season_id, name) values (v_season, 'Baker C') returning id into baker_c;
  insert into bakers (season_id, name) values (v_season, 'Baker D') returning id into baker_d;

  -- Episode 1: aired and scored.
  insert into episodes (season_id, number, deadline_at, status)
    values (v_season, 1, now() - interval '1 day', 'complete') returning id into ep1;
  -- Episode 2: deadline still in the future — picks must stay private.
  insert into episodes (season_id, number, deadline_at, status)
    values (v_season, 2, now() + interval '1 day', 'upcoming') returning id into ep2;
  -- Episode 3: no deadline at all (schedule unannounced) — must FAIL CLOSED.
  insert into episodes (season_id, number, status)
    values (v_season, 3, 'upcoming') returning id into ep3;

  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league, 'P One',   'smoketestone',   '#2a78d6') returning id into p1;
  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league, 'P Two',   'smoketesttwo',   '#eb6834') returning id into p2;
  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league, 'P Three', 'smoketestthree', '#1baf7a') returning id into p3;

  -- ---- episode 1 results ----------------------------------------------
  -- Star Baker A · TWO bakers leave (B and C) · technical D
  -- bingo hits TWO bakers (A and B) · handshake voided

  insert into episode_results (episode_id, category, baker_id) values
    (ep1, 'best',      baker_a),
    (ep1, 'leaving',   baker_b),
    (ep1, 'leaving',   baker_c),
    (ep1, 'technical', baker_d),
    (ep1, 'bingo',     baker_a),
    (ep1, 'bingo',     baker_b);
  insert into episode_results (episode_id, category, voided) values (ep1, 'handshake', true);

  -- ---- entries ---------------------------------------------------------

  -- P1: everything right. Names ONE of the two leaving bakers and ONE of the
  -- two bingo bakers, so this is the no-double-counting test.
  insert into entries (player_id, episode_id) values (p1, ep1) returning id into e1;
  insert into predictions (entry_id, category, baker_id) values
    (e1, 'best', baker_a), (e1, 'leaving', baker_b), (e1, 'technical', baker_d),
    (e1, 'bingo', baker_a), (e1, 'handshake', baker_a);

  -- P2: read two bakers exactly backwards. Both penalties should fire.
  insert into entries (player_id, episode_id) values (p2, ep1) returning id into e2;
  insert into predictions (entry_id, category, baker_id) values
    (e2, 'best', baker_b), (e2, 'leaving', baker_a);

  -- P3: would have scored, but the GM disallowed the entry.
  insert into entries (player_id, episode_id, lateness, is_disallowed)
    values (p3, ep1, 'very_late', true) returning id into e3;
  insert into predictions (entry_id, category, baker_id) values
    (e3, 'best', baker_a), (e3, 'bingo', baker_b);

  -- ---- scoring ---------------------------------------------------------

  select points into got from v_episode_scores where player_id = p1 and episode_id = ep1;
  assert got = 11, format(
    'P1 should score 11 (best 4 + leaving 3 + technical 2 + bingo 2 + voided handshake 0), got %s. '
    'If it is 14, a category with two correct bakers paid twice.', got);

  select points into got from v_episode_scores where player_id = p2 and episode_id = ep1;
  assert got = -2, format(
    'P2 should score -2 (Best Baker who left, plus Leaving Baker who took Star Baker), got %s.', got);

  select count(*) into got from v_episode_scores where player_id = p3;
  assert got = 0, format('A disallowed entry must not appear in scoring at all, got %s row(s).', got);

  select count(*) into got from v_penalties where player_id = p1;
  assert got = 0, format('P1 earned no penalty, got %s.', got);

  select count(*) into got from v_penalties where player_id = p2;
  assert got = 2, format('P2 should take both penalties, got %s.', got);

  -- A voided category pays nobody, and cannot trigger a penalty either.
  select count(*) into got from v_prediction_scores
    where episode_id = ep1 and category = 'handshake' and is_correct;
  assert got = 0, format('A voided category must score nothing, got %s correct.', got);

  -- ---- THE DEADLINE GATE ----------------------------------------------
  -- The single most important assertion in this file. If predictions leak
  -- before their deadline, the game is over before it starts.

  -- 9 = P1's five, P2's two, P3's two. Disallowed entries ARE public (flagged),
  -- so the prediction wall can show them struck through; they are excluded from
  -- scoring, not from view.
  select count(*) into got from v_public_predictions where episode_id = ep1;
  assert got = 9, format(
    'Episode 1 is past its deadline, so all 9 predictions should be public, got %s.', got);

  insert into entries (player_id, episode_id) values (p1, ep2) returning id into e1;
  insert into predictions (entry_id, category, baker_id) values (e1, 'best', baker_a);
  select count(*) into got from v_public_predictions where episode_id = ep2;
  assert got = 0, format(
    'LEAK: episode 2''s deadline has not passed but %s prediction(s) are public.', got);

  insert into entries (player_id, episode_id) values (p1, ep3) returning id into e1;
  insert into predictions (entry_id, category, baker_id) values (e1, 'best', baker_a);
  select count(*) into got from v_public_predictions where episode_id = ep3;
  assert got = 0, format(
    'LEAK: episode 3 has no deadline set, so it must FAIL CLOSED, but %s prediction(s) are public. '
    'Check that v_public_predictions still tests `deadline_at is not null`.', got);

  -- ---- top three -------------------------------------------------------

  update bakers set status = 'winner'     where id = baker_a;
  update bakers set status = 'finalist'   where id = baker_b;
  update bakers set status = 'eliminated' where id = baker_d;

  insert into top_picks (player_id, baker_id, rank) values
    (p1, baker_a, 1), (p1, baker_b, 2), (p1, baker_d, 3);

  select points into got from v_series_bonus where player_id = p1;
  assert got = 12, format(
    'Two finalists (+3 each) plus the winner among them (+6) is 12, got %s.', got);

  select has_winner into got_bool from v_series_bonus where player_id = p1;
  assert got_bool, 'The winner is in P1''s top three, so has_winner should be true.';

  -- ---- standings -------------------------------------------------------

  select total_points into got from v_standings where player_id = p1;
  assert got = 23, format('P1: 11 from episode 1 plus 12 in bonuses = 23, got %s.', got);

  select total_points into got from v_standings where player_id = p3;
  assert got = 0, format('P3''s only entry was disallowed, so the total is 0, got %s.', got);

  -- Every player appears, including one who has never scored — the leaderboard
  -- would otherwise silently drop people.
  select count(*) into got from v_standings where league_id = v_league;
  assert got = 3, format('All 3 players should stand in the league table, got %s.', got);

  -- ---- baker stats -----------------------------------------------------

  select star_bakers into got from v_baker_stats where baker_id = baker_a;
  assert got = 1, format('Baker A took one Star Baker, got %s.', got);

  -- Sourced from v_public_predictions, so episode 2 and 3's picks must not be
  -- counted here — that would leak this week's thinking through an aggregate.
  select picked_best into got from v_baker_stats where baker_id = baker_a;
  assert got = 1, format(
    'Only episode 1''s public pick of Baker A for Best Baker should count (P3''s is '
    'disallowed, episodes 2 and 3 are not public yet), got %s.', got);

end $$;

rollback;

-- Reached only if every assertion above held — a failure aborts the script
-- before this line.
select 'SMOKE TEST PASSED — scoring and the deadline gate behave. Nothing was written.' as result;
