-- ============================================================
-- Fantasy Bake Off — smoke test
-- ============================================================
-- Paste the whole file into the Supabase SQL editor and run it.
--
--   a row reading "SMOKE TEST PASSED"  → scoring, all three reveal gates, the
--                                        three result states and the bake
--                                        guess's tiers all behave.
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
  v_league2 uuid;
  baker_a uuid; baker_b uuid; baker_c uuid; baker_d uuid;
  ep1 uuid; ep2 uuid; ep3 uuid; ep4 uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; p5 uuid; p6 uuid; p7 uuid;
  e1 uuid; e2 uuid; e3 uuid; e5 uuid;
  got int;
  got_bool boolean;
  got_text text;
  got_json jsonb;
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

  -- THE TWO MOMENTS ARE SET SEPARATELY THROUGHOUT THIS FILE, because they are
  -- two moments now: picks close at the deadline, and everything goes public
  -- two hours later when the episode airs. Setting only one of them was fine
  -- while they were the same instant and is a fixture bug now — a reveal test
  -- with a null live_at asserts nothing but "fails closed", and a penalty test
  -- with a null deadline_at charges nobody.

  -- Episode 1: closed, aired, scored.
  insert into episodes (season_id, number, deadline_at, live_at, status)
    values (v_season, 1, now() - interval '1 day', now() - interval '22 hours', 'complete')
    returning id into ep1;
  -- Episode 2: both moments still to come — picks must stay private, and nobody
  -- may be charged for not having submitted yet.
  insert into episodes (season_id, number, deadline_at, live_at, status)
    values (v_season, 2, now() + interval '1 day', now() + interval '26 hours', 'upcoming')
    returning id into ep2;
  -- Episode 3: no dates at all (schedule unannounced) — must FAIL CLOSED on the
  -- reveal, and must charge nobody for missing a deadline that does not exist.
  insert into episodes (season_id, number, status)
    values (v_season, 3, 'upcoming') returning id into ep3;

  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league, 'P One',   'smoketestone',   '#2a78d6') returning id into p1;
  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league, 'P Two',   'smoketesttwo',   '#eb6834') returning id into p2;
  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league, 'P Three', 'smoketestthree', '#1baf7a') returning id into p3;
  -- The three shapes of missing the deadline (RULES §2.5). Each one exists to
  -- pin a different branch of v_penalties' two new arms, and between them they
  -- are the whole of it: late-with-picks, an empty card, and never showing up.
  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league, 'P Five',  'smoketestfive',  '#7a4fc4') returning id into p5;
  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league, 'P Six',   'smoketestsix',   '#d64a8a') returning id into p6;
  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league, 'P Seven', 'smoketestseven', '#c9a227') returning id into p7;

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

  -- P5: in after 18:00, with one correct pick. Late picks still SCORE — the
  -- penalty is a flat fee for missing the deadline, not a forfeit.
  insert into entries (player_id, episode_id, lateness)
    values (p5, ep1, 'late') returning id into e5;
  insert into predictions (entry_id, category, baker_id) values (e5, 'technical', baker_d);

  -- P6: opened the panel, saved nothing. An entry row with no predictions is a
  -- real state, not a fixture curiosity — the GM's Entries tab counts
  -- `picks_made > 0` as "in" precisely because of it.
  insert into entries (player_id, episode_id) values (p6, ep1);

  -- P7: never showed up at all. No entry row anywhere, which is why the
  -- no_entry arm of v_penalties cannot be built on `entries`.

  -- ---- scoring ---------------------------------------------------------

  select points into got from v_episode_scores where player_id = p1 and episode_id = ep1;
  assert got = 11, format(
    'P1 should score 11 (best 4 + leaving 3 + technical 2 + bingo 2 + voided handshake 0), got %s. '
    'If it is 14, a category with two correct bakers paid twice.', got);

  select points into got from v_episode_scores where player_id = p2 and episode_id = ep1;
  assert got = -2, format(
    'P2 should score -2 (Best Baker who left, plus Leaving Baker who took Star Baker), got %s.', got);

  -- A disallowed entry pays NOTHING and costs 2 — it is not scored, and it is
  -- not a submission either. RULES §2.5 says it counts "as if it were never
  -- made", and the deadline penalty takes that literally.
  --
  -- THIS ASSERTION USED TO READ "must not appear in scoring at all, 0 rows".
  -- That was right when nothing could reach a player who had not submitted;
  -- now the no_entry arm can, so the row exists and carries exactly the −2. If
  -- you are reading this because the count came back 0, the penalty is being
  -- computed and then thrown away for want of a spine row in v_episode_scores.
  select points into got from v_episode_scores where player_id = p3 and episode_id = ep1;
  assert got = -2, format(
    'P3''s entry is disallowed, so their picks pay nothing and the week costs them the '
    'flat -2 for having nothing in. Got %s.', got);

  select pick_points into got from v_episode_scores where player_id = p3 and episode_id = ep1;
  assert got = 0, format(
    'A disallowed entry''s picks must still score nothing — the -2 above must not be '
    'hiding points that are also being counted. Got %s.', got);

  select count(*) into got from v_penalties where player_id = p1;
  assert got = 0, format('P1 earned no penalty, got %s.', got);

  select count(*) into got from v_penalties where player_id = p2;
  assert got = 2, format('P2 should take both penalties, got %s.', got);

  -- Which pick brought each penalty on. The player panel puts the −1 against
  -- that category and explains it, so the reason has to survive into the
  -- granted view — the browser must never work this out for itself.
  select jsonb_array_length(penalties) into got from v_episode_scores
    where player_id = p2 and episode_id = ep1;
  assert got = 2, format('Both of P2''s penalties should be itemised, got %s.', got);

  select penalties into got_json from v_episode_scores
    where player_id = p2 and episode_id = ep1;
  assert got_json @> '[{"category": "best", "reason": "best_left", "points": -1}]'::jsonb,
    format('P2 named a Best Baker who left, against the "best" row. Got %s.', got_json);
  assert got_json @> '[{"category": "leaving", "reason": "leaving_starred", "points": -1}]'::jsonb,
    format('P2 named a Leaving Baker who starred, against the "leaving" row. Got %s.', got_json);

  select jsonb_array_length(penalties) into got from v_episode_scores
    where player_id = p1 and episode_id = ep1;
  assert got = 0, format(
    'P1 earned no penalty, so the itemised list is empty rather than null — the panel '
    'iterates it. Got %s.', got);

  -- P2's count of 2 above is also the on-time check: they submitted before the
  -- deadline, so the two -1s are ALL they may take. A third row there would mean
  -- the deadline penalty is firing for somebody who was never late.

  -- ---- THE DEADLINE PENALTY --------------------------------------------
  -- RULES §2.5. Nothing live in by 18:00 costs 2 points, in three flavours, and
  -- the flavours must never overlap: exactly one -2 per player per week.
  --
  -- The floor for a week is therefore -4 — both pick penalties plus this one —
  -- and NOT -6. If these start summing to -4 on their own, the `exists` in the
  -- late arm has stopped being the exact negation of the `not exists` in the
  -- no_entry arm, and somebody is being charged twice for one act.

  -- LATE, with picks. The picks still score: the penalty is a flat fee for
  -- missing the deadline, not a forfeit. That is what keeps submitting late
  -- strictly better than giving up, which is the whole point of the flat rate.
  select pick_points into got from v_episode_scores where player_id = p5 and episode_id = ep1;
  assert got = 2, format(
    'P5 was late but named the technical winner, and a late pick still scores. Got %s.', got);

  select penalty_points into got from v_episode_scores where player_id = p5 and episode_id = ep1;
  assert got = -2, format('A late entry costs a flat -2, got %s.', got);

  select points into got from v_episode_scores where player_id = p5 and episode_id = ep1;
  assert got = 0, format('P5: 2 from the technical, less the -2 for being late, is 0. Got %s.', got);

  select count(*) into got from v_penalties where player_id = p5 and episode_id = ep1;
  assert got = 1, format(
    'P5 must take the deadline penalty EXACTLY ONCE, got %s. If it is 2, the late and '
    'no_entry arms are both matching the same entry.', got);

  -- The reason travels with it, because the panel says which kind of late it
  -- was in words. The category is NULL: this is about the week, not about any
  -- one pick, and Scorecard.jsx finds a pick's penalty by matching the category
  -- — so a null is what stops the -2 landing on an innocent pick cell.
  select penalties into got_json from v_episode_scores where player_id = p5 and episode_id = ep1;
  assert got_json @> '[{"category": null, "reason": "late", "points": -2}]'::jsonb,
    format('The late penalty must itemise with a null category. Got %s.', got_json);

  -- VERY LATE costs exactly the same. The GM only opens that door for a genuine
  -- mishap, and the Disallow switch is what handles bad faith — so there is no
  -- ladder here, just the one fee.
  update entries set lateness = 'very_late' where id = e5;

  select penalty_points into got from v_episode_scores where player_id = p5 and episode_id = ep1;
  assert got = -2, format('A very late entry costs the same flat -2, got %s.', got);

  select penalties into got_json from v_episode_scores where player_id = p5 and episode_id = ep1;
  assert got_json @> '[{"category": null, "reason": "very_late", "points": -2}]'::jsonb,
    format('Very late must reach the panel as its own reason, to be worded as its own '
           'sentence. Got %s.', got_json);

  update entries set lateness = 'late' where id = e5;

  -- AN EMPTY CARD is not a submission. P6 saved an entry row with nothing in it.
  select points into got from v_episode_scores where player_id = p6 and episode_id = ep1;
  assert got = -2, format(
    'P6 saved an empty card, which is not a submission, so it costs -2. Got %s. If it '
    'is 0, the late arm is matching on the entry row rather than on its picks.', got);

  select penalties into got_json from v_episode_scores where player_id = p6 and episode_id = ep1;
  assert got_json @> '[{"category": null, "reason": "no_entry", "points": -2}]'::jsonb,
    format('An empty card is charged as no_entry, not as late. Got %s.', got_json);

  -- NEVER SHOWED UP. THE ONE THAT NEEDS THE SPINE: P7 has no entry and no guess,
  -- so before v_episode_scores grew its third spine arm this penalty was
  -- computed by v_penalties and then silently dropped by the join.
  select count(*) into got from entries where player_id = p7;
  assert got = 0, 'Fixture check: P7 is supposed to have no entry at all.';

  select count(*) into got from v_episode_scores where player_id = p7 and episode_id = ep1;
  assert got = 1, format(
    'P7 never submitted, so v_episode_scores must still give them a row for the week to '
    'carry the -2. Got %s row(s) — if 0, the spine has no arm for penalties and the '
    'charge vanishes before it reaches the standings.', got);

  select points into got from v_episode_scores where player_id = p7 and episode_id = ep1;
  assert got = -2, format('Not submitting at all costs -2, got %s.', got);

  select total_points into got from v_standings where player_id = p7;
  assert got = -2, format(
    'The -2 has to reach the league table, not just the week. Got %s.', got);

  -- A DEADLINE THAT HAS NOT PASSED CHARGES NOBODY. Episode 2's is still to come
  -- and episode 3 has none at all — the state every episode in the real database
  -- is in until the schedule is announced. Without this gate a freshly seeded
  -- season would hand every player -20 on day one, for weeks that have not
  -- happened.
  select count(*) into got from v_penalties where player_id = p7 and episode_id = ep2;
  assert got = 0, format(
    'Episode 2''s deadline has not passed, so nobody may be charged for it yet. Got %s.', got);

  select count(*) into got from v_penalties where player_id = p7 and episode_id = ep3;
  assert got = 0, format(
    'Episode 3 has no deadline at all, so there is nothing to be late for. Got %s. '
    'Check that the no_entry arm still tests `deadline_at is not null`.', got);

  -- A voided category pays nobody, and cannot trigger a penalty either.
  select count(*) into got from v_prediction_scores
    where episode_id = ep1 and category = 'handshake' and is_correct;
  assert got = 0, format('A voided category must score nothing, got %s correct.', got);

  -- ---- THE REVEAL GATE -------------------------------------------------
  -- The single most important assertion in this file. If predictions leak
  -- before the episode airs, the game is over before it starts.
  --
  -- IT IS THE REVEAL GATE AND NOT THE DEADLINE GATE ANY MORE. The two moments
  -- came apart in RULES §2.5: 18:00 closes the picks and prices lateness, 20:00
  -- airs the episode and publishes everyone's card. The window between them is
  -- what this section now exists to protect — a latecomer submitting at 19:00
  -- must be guessing blind, exactly like everybody who was on time.

  -- 10 = P1's five, P2's two, P3's two and P5's one. Disallowed entries ARE
  -- public (flagged), so the prediction wall can show them struck through; they
  -- are excluded from scoring, not from view. P6 saved an empty card and P7
  -- nothing at all, so neither has a prediction to publish.
  select count(*) into got from v_public_predictions where episode_id = ep1;
  assert got = 10, format(
    'Episode 1 has aired, so all 10 predictions should be public, got %s.', got);

  -- THE NEW WINDOW, and the reason the change was worth making. Put episode 1
  -- back to half past six — deadline gone, broadcast still to come — and every
  -- card must be sealed. Before the split this was the two hours in which a late
  -- entry could be written with the whole league's picks on screen.
  update episodes set live_at = now() + interval '1 hour' where id = ep1;

  select count(*) into got from v_public_predictions where episode_id = ep1;
  assert got = 0, format(
    'LEAK: episode 1 is past its DEADLINE but has not aired, so nothing may be public '
    'yet — this is the window a late entry is submitted in. Got %s prediction(s). If '
    'this fails, the gate is back on deadline_at, and being LATE means seeing '
    'everyone else''s card before you write your own.', got);

  update episodes set live_at = now() - interval '22 hours' where id = ep1;

  insert into entries (player_id, episode_id) values (p1, ep2) returning id into e1;
  insert into predictions (entry_id, category, baker_id) values (e1, 'best', baker_a);
  select count(*) into got from v_public_predictions where episode_id = ep2;
  assert got = 0, format(
    'LEAK: episode 2 has not aired but %s prediction(s) are public.', got);

  insert into entries (player_id, episode_id) values (p1, ep3) returning id into e1;
  insert into predictions (entry_id, category, baker_id) values (e1, 'best', baker_a);
  select count(*) into got from v_public_predictions where episode_id = ep3;
  assert got = 0, format(
    'LEAK: episode 3 has no air time set, so it must FAIL CLOSED, but %s prediction(s) are public. '
    'Check that v_public_predictions still tests `live_at is not null`.', got);

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

  -- ---- WHICH WEEK THE BONUS LANDS IN -----------------------------------
  -- RULES §5: "The +3s are awarded when the semi-final ends and the finalists
  -- are known; the +6 lands at the final." The bonus carried no episode at all
  -- until v_series_bonus_scores, which made the chart disagree with the
  -- leaderboard by up to 15 points from the semi-final onwards, and made the
  -- shake-up RULES §5 promises impossible — movement is a re-rank of episode
  -- points, and the bonus was not in them.
  --
  -- The season holds episodes 1, 2 and 3 at this point, so the final is episode
  -- 3 and the semi-final episode 2. Both are DERIVED from the numbering and
  -- nothing stores them, which is why episode 7 arriving later in this file
  -- moves them — asserted at the end.

  select bonus_points into got from v_episode_scores
   where player_id = p1 and episode_id = ep2;
  assert got = 6, format(
    'Two finalists at +3 each must land on the SEMI-FINAL, which is episode 2 at '
    'this point. Got %s.', coalesce(got, 0));

  select bonus_points into got from v_episode_scores
   where player_id = p1 and episode_id = ep3;
  assert got = 6, format(
    'The +6 for having the winner must land on the FINAL, which is episode 3 at '
    'this point. Got %s.', coalesce(got, 0));

  select coalesce(bonus_points, 0) into got from v_episode_scores
   where player_id = p1 and episode_id = ep1;
  assert got = 0, format(
    'Episode 1 is neither the final nor the semi-final, so no bonus may land '
    'there. Got %s.', got);

  -- The split must add up to the whole. If this fails while the two above pass,
  -- one half of the bonus has been dropped rather than moved.
  select coalesce(sum(bonus_points), 0) into got from v_episode_scores where player_id = p1;
  assert got = 12, format(
    'The per-episode split must sum to v_series_bonus.points, which is 12. Got %s.', got);

  -- ---- THE TOP THREE GATE ----------------------------------------------
  -- The reveal gate again, on the same clock. RULES §5 reveals everyone's three
  -- at the START of episode 2 — which is episode 2's air time, not its deadline,
  -- and is why v_top_picks_public derives the moment from the episode rather
  -- than storing a second date. This is the assertion standing between a private
  -- pick and the whole league reading it a week early.
  --
  -- The LOCK is still 18:00 (api/player.js), and the two are toggled separately
  -- below for that reason: moving the deadline here would charge every fixture
  -- player the -2 for episode 2 and quietly rewrite the standings asserted
  -- further down.

  select count(*) into got from v_top_picks_public where player_id = p1;
  assert got = 0, format(
    'LEAK: episode 2 has not aired but %s top pick(s) are public.', got);

  -- The aggregate route to the same secret, and the reason this gate is not
  -- just about the new view: v_baker_stats is granted, so an ungated count here
  -- published "N people are riding on Baker A" as surely as naming them would.
  select in_top_threes into got from v_baker_stats where baker_id = baker_a;
  assert got = 0, format(
    'LEAK: v_baker_stats.in_top_threes must read v_top_picks_public, not '
    'top_picks, so that it respects the episode 2 gate. Got %s.', got);

  -- Now let the reveal happen and check that it actually does — a gate welded
  -- shut passes both assertions above for entirely the wrong reason.
  update episodes set live_at = now() - interval '1 hour' where id = ep2;

  select count(*) into got from v_top_picks_public where player_id = p1;
  assert got = 3, format(
    'Episode 2 has aired, so all 3 of P1''s top picks should be public, got %s.', got);

  select baker_name into got_text from v_top_picks_public where player_id = p1 and rank = 1;
  assert got_text = 'Baker A', format(
    'v_top_picks_public must carry the baker''s NAME: the browser cannot look up '
    'one who has left the tent. Got %s.', coalesce(got_text, 'NULL'));

  -- Dead picks are greyed on the board, never dropped — you are stuck with your
  -- three even after one goes home (RULES §5). Baker D was eliminated above.
  select count(*) into got from v_top_picks_public
   where player_id = p1 and baker_status = 'eliminated';
  assert got = 1, format(
    'An eliminated top pick must still appear, to be greyed rather than vanish. Got %s.', got);

  select in_top_threes into got from v_baker_stats where baker_id = baker_a;
  assert got = 1, format('Baker A is in one top three, got %s.', got);

  -- Put it back. The picked_best assertion below depends on episode 2's picks
  -- still being private, and would otherwise fail for a reason that has nothing
  -- to do with what it is testing.
  update episodes set live_at = now() + interval '26 hours' where id = ep2;

  -- ---- standings -------------------------------------------------------

  select total_points into got from v_standings where player_id = p1;
  assert got = 23, format(
    'P1: 11 from episode 1 plus 12 in bonuses = 23, got %s. This number did not '
    'change when the bonus was given the two weeks above — only where it lands '
    'did. A total of 35 means it is being counted twice.', got);

  select total_points into got from v_standings where player_id = p3;
  assert got = -2, format(
    'P3''s only entry was disallowed, so it pays nothing AND counts as nothing having '
    'been submitted: the total is -2, got %s.', got);

  -- Every player appears, including one who has never scored — the leaderboard
  -- would otherwise silently drop people.
  select count(*) into got from v_standings where league_id = v_league;
  assert got = 6, format('All 6 players should stand in the league table, got %s.', got);

  -- ---- baker stats -----------------------------------------------------

  select star_bakers into got from v_baker_stats where baker_id = baker_a;
  assert got = 1, format('Baker A took one Star Baker, got %s.', got);

  -- Sourced from v_public_predictions, so episode 2 and 3's picks must not be
  -- counted here — that would leak this week's thinking through an aggregate.
  select picked_best into got from v_baker_stats where baker_id = baker_a;
  assert got = 1, format(
    'Only episode 1''s public pick of Baker A for Best Baker should count (P3''s is '
    'disallowed, episodes 2 and 3 are not public yet), got %s.', got);

  -- ---- the results view -----------------------------------------------
  -- v_episode_results_public is what puts a tick or a cross on the player
  -- panel. Three states have to survive the trip to the browser, and the
  -- difference between the first two is load-bearing (RULES §3, DESIGN §7):
  --
  --   no row at all              not decided yet   shown plainly blank
  --   one voided row, no baker   Nobody won it     shown hatched, struck out
  --   a row with a baker         a winner          shown ticked or crossed
  --
  -- Deliberately last in this file: it writes one more result row, which would
  -- move the scoring and baker-stats numbers asserted above.

  select count(*) into got from v_episode_results_public where episode_id = ep1;
  assert got = 7, format(
    'Episode 1 has 7 result rows (best, two leaving, technical, two bingo and one '
    'voided handshake), got %s. If it is 6, the join to bakers is not a LEFT join '
    'and the Nobody row has been dropped.', got);

  select count(*) into got from v_episode_results_public
    where episode_id = ep1 and category = 'handshake'
      and voided and baker_id is null and baker_name is null;
  assert got = 1, format(
    'The voided handshake must arrive as a VOIDED row carrying no baker: "Nobody won '
    'it" and "not decided yet" are different states and the UI must not be able to '
    'confuse them. Got %s such row(s).', got);

  select count(*) into got from v_episode_results_public
    where episode_id = ep1 and category = 'leaving' and not voided;
  assert got = 2, format(
    'Both leaving bakers must come through — the panel says what the answer actually '
    'was, and this week it was two people. Got %s.', got);

  select baker_name into got_text from v_episode_results_public
    where episode_id = ep1 and category = 'best';
  assert got_text = 'Baker A', format(
    'The view has to name the winner. The browser cannot look it up: a leaving baker '
    'is out of the tent, and gone from the panel''s cast list, by the time the result '
    'lands. Got %s.', coalesce(got_text, '<null>'));

  select count(*) into got from v_episode_results_public where episode_id = ep2;
  assert got = 0, format(
    'Episode 2 has no results, so it must have NO ROWS here. That absence is the only '
    'way the panel knows a category is still to come. Got %s.', got);

  -- Results are NOT deadline-gated, on purpose: a result is a fact about a
  -- broadcast episode, not a pick. Episode 3 has no deadline at all — the case
  -- that makes v_public_predictions fail closed — and a result there must
  -- still be visible.
  insert into episode_results (episode_id, category, baker_id) values (ep3, 'technical', baker_d);
  select count(*) into got from v_episode_results_public where episode_id = ep3;
  assert got = 1, format(
    'Episode 3 has no deadline, and its result must still be public: results are facts '
    'about the episode, not picks. Got %s. If it is 0, the deadline gate has been '
    'copied in from v_public_predictions.', got);

  -- ---- THE TWO DERIVED MOMENTS -----------------------------------------
  -- Picks close at 18:00 on the air date; the panel locks at 20:00 when the
  -- episode goes on air. Both follow air_date through schema.sql's trigger.
  --
  -- The lock used to be a timestamp the GM stamped by pressing "Go live", which
  -- made RULES §2.5's promise rest on somebody remembering to press a button
  -- mid-episode. These assertions are what replaced that button.

  insert into episodes (season_id, number, air_date, status)
    values (v_season, 7, date '2026-10-06', 'upcoming') returning id into ep4;

  select (deadline_at at time zone 'Europe/London')::time into got_text
    from episodes where id = ep4;
  assert got_text = '18:00:00', format(
    'An air date must set the deadline to 18:00 UK, got %s.', coalesce(got_text, '<null>'));

  select (live_at at time zone 'Europe/London')::time into got_text
    from episodes where id = ep4;
  assert got_text = '20:00:00', format(
    'An air date must set the lock to 20:00 UK, got %s. If it is null, the trigger '
    'is not deriving live_at and the panel will never lock by itself.',
    coalesce(got_text, '<null>'));

  -- Moving the date moves BOTH.
  update episodes set air_date = date '2026-10-13' where id = ep4;
  select (live_at at time zone 'Europe/London')::date into got_text
    from episodes where id = ep4;
  assert got_text = '2026-10-13', format(
    'Moving the air date must move the lock with it, got %s.', coalesce(got_text, '<null>'));

  -- An override set on its own is left alone: the date did not move, so there
  -- is nothing to re-derive. This is the ordinary "this week airs at 21:00" edit.
  update episodes set live_at = fbo_derive_live(air_date) + interval '1 hour' where id = ep4;
  select (live_at at time zone 'Europe/London')::time into got_text
    from episodes where id = ep4;
  assert got_text = '21:00:00', format(
    'Setting the lock time without touching the air date must stick, got %s.',
    coalesce(got_text, '<null>'));

  -- An override sent in the SAME statement as an air-date change also wins.
  -- That is the escape hatch — move the episode and set its odd hour together —
  -- and it is exactly how deadline_at has always behaved.
  update episodes
     set air_date = date '2026-10-20',
         live_at  = fbo_derive_live(date '2026-10-20') + interval '1 hour'
   where id = ep4;
  select (live_at at time zone 'Europe/London')::time into got_text
    from episodes where id = ep4;
  assert got_text = '21:00:00', format(
    'A lock time set in the same write as the air date must win over the derived '
    'one, got %s.', coalesce(got_text, '<null>'));

  -- But an override set EARLIER does not survive a later date change on its
  -- own. Moving an episode to another day re-derives both moments, because
  -- "20:00 on the new day" is a better answer than "21:00 carried over from the
  -- old one" — and because the deadline has always worked this way, so the two
  -- must not diverge.
  --
  -- 2026-10-27 is past the BST→GMT switch on the 25th, so this also proves the
  -- named time zone is doing its job: 20:00 LOCAL either side of the change.
  update episodes set air_date = date '2026-10-27' where id = ep4;
  select (live_at at time zone 'Europe/London')::time into got_text
    from episodes where id = ep4;
  assert got_text = '20:00:00', format(
    'Moving the air date alone must re-derive the lock to 20:00 on the new day, '
    'got %s. If it is 21:00, an old override is outliving the date it belonged '
    'to; if it is 19:00 or 21:00 after the clocks change, the conversion is not '
    'going through Europe/London.', coalesce(got_text, '<null>'));

  -- Clearing the air date clears both, so an episode with no schedule locks
  -- nobody out — the same direction lockState fails in.
  update episodes set live_at = null where id = ep4;
  update episodes set air_date = null where id = ep4;
  select count(*) into got from episodes
    where id = ep4 and deadline_at is null and live_at is null;
  assert got = 1, 'Clearing the air date must clear both derived moments.';

  -- ---- IS IT ON AIR ----------------------------------------------------
  -- Computed from the lock time, never stored: a status somebody has to set is
  -- a status that goes stale.
  update episodes set live_at = now() - interval '1 hour', status = 'locked' where id = ep4;
  select is_live into got_bool from v_episodes_public where id = ep4;
  assert got_bool, 'Past its lock time and not complete: the episode is on air.';

  update episodes set status = 'complete' where id = ep4;
  select is_live into got_bool from v_episodes_public where id = ep4;
  assert not got_bool, 'A completed episode is not on air, whatever its lock time says.';

  update episodes set live_at = now() + interval '1 hour', status = 'upcoming' where id = ep4;
  select is_live into got_bool from v_episodes_public where id = ep4;
  assert not got_bool, 'An episode whose lock time is still to come is not on air.';

  update episodes set live_at = null where id = ep4;
  select is_live into got_bool from v_episodes_public where id = ep4;
  assert not got_bool, 'No lock time, no broadcast: is_live must fail closed.';

  -- ---- THE BAKE GUESS --------------------------------------------------
  -- RULES §6. Two bakes per player, named once before episode 1; a guess pays
  -- the week it comes up, ONCE, and only if few enough people said it.
  --
  -- Deliberately last in this file: the hits below add points to
  -- v_episode_scores and v_standings, which nearly every assertion above reads.

  -- P1 alone says madeleine. P2 and P3 both say croquembouche. All three say
  -- cake — the obvious guess that pays nobody, which is the tier that stops a
  -- one-word answer being worth anything.
  insert into series_guesses (player_id, slot, guess_text, guess_key) values
    (p1, 1, 'Madeleine',     'madeleine'),
    (p1, 2, 'Cake',          'cake'),
    (p2, 1, 'Croquembouche', 'croquembouche'),
    (p2, 2, 'cake',          'cake'),
    (p3, 1, 'croquembouche', 'croquembouche'),
    (p3, 2, 'CAKE',          'cake');

  -- ---- THE REVEAL GATE -------------------------------------------------
  -- The load-bearing filter a third time, on a third episode. The bake guesses
  -- LOCK at episode 1's deadline and are REVEALED when episode 1 airs, exactly
  -- as the top three locks and reveals around episode 2. Without the gate people
  -- read each other's guesses while still deciding their own — and a guess is
  -- worth +5 precisely for being one that nobody else thought of.
  --
  -- Episode 1 has already aired in these fixtures, so take its air time away to
  -- test the closed case, then put it back — the disallowed-guess assertion
  -- further down reads v_series_guesses_public and needs the gate open again.
  --
  -- ONLY live_at IS TOUCHED BELOW, AND THAT MATTERS TWICE OVER. It is the column
  -- the gate now reads; and moving episode 1's DEADLINE instead would re-price
  -- everybody's lateness mid-test, changing the standings this file has already
  -- asserted. Setting either directly leaves schema.sql's trigger alone, which
  -- only derives when the same write also changed air_date.
  --
  -- EVERY QUERY BELOW IS SCOPED TO THE FIXTURE PLAYERS. v_series_guesses_public
  -- carries no season_id or league_id — like v_top_picks_public, its callers
  -- filter by the player ids from v_standings — so an unscoped count here reads
  -- the REAL league's guesses too and fails for reasons that have nothing to do
  -- with this test. It did exactly that on the first run.
  update episodes set live_at = null where id = ep1;

  select count(*) into got from v_series_guesses_public where player_id in (p1, p2, p3);
  assert got = 0, format(
    'LEAK: episode 1 has no air time, so it must FAIL CLOSED, but %s guess(es) are '
    'public. Check that v_series_guesses_public still tests `live_at is not null`.',
    got);

  -- A broadcast still to come is the other closed case, and the one that is true
  -- for every episode in the real database today.
  update episodes set live_at = now() + interval '1 day' where id = ep1;

  select count(*) into got from v_series_guesses_public where player_id in (p1, p2, p3);
  assert got = 0, format(
    'LEAK: episode 1 has not aired but %s guess(es) are public.', got);

  -- THE GATE MUST FOLLOW THE SCHEDULE AND NOT A BUTTON, which is the whole
  -- history of this line and the reason it is asserted rather than assumed.
  --
  -- It read live_at once before and that WAS a bug: live_at was stamped by the
  -- GM pressing "Go live" and cleared by "Take it back", and Take it back was
  -- for a while the only route from live to complete — so every episode reached
  -- "over" with a null live_at and this board emptied the moment the episode
  -- finished. The gate was moved to deadline_at to escape that, and has now
  -- moved back, because live_at is DERIVED from air_date by schema.sql's trigger
  -- and no button touches it any more.
  --
  -- So the reveal is opened here the way the real thing opens it: by giving the
  -- episode an air date and letting the trigger do the rest. A yesterday's date
  -- puts both derived moments in the past, which leaves episode 1's deadline
  -- where the fixtures had it and the lateness penalties undisturbed.
  update episodes set air_date = current_date - 1 where id = ep1;

  select (live_at is not null) into got_bool from episodes where id = ep1;
  assert got_bool,
    'An air date must derive a live_at through the trigger. If this fails the trigger '
    'is gone, and every reveal gate in views.sql now depends on a column nothing sets.';

  select count(*) into got from v_series_guesses_public where player_id in (p1, p2, p3);
  assert got = 6, format(
    'Episode 1 aired yesterday, so all 6 guesses should be public, got %s. The date was '
    'set and the trigger derived the rest — no button was pressed, which is exactly the '
    'property this gate lost once before.', got);

  select guess_text into got_text from v_series_guesses_public where player_id = p1 and slot = 1;
  assert got_text = 'Madeleine', format(
    'The board shows what the player TYPED, never the GM''s canonical key — '
    'unifying is scoring-relevant, so the edit has to stay auditable. Got %s.',
    coalesce(got_text, '<null>'));

  -- ---- THE TIERS -------------------------------------------------------
  -- Nothing has come up yet, so nothing pays. A guess that never appears is
  -- worth nothing, which is the difference between this view and one that
  -- simply counts holders.
  -- Scoped to this season for the same reason as above: the real league's
  -- guesses are in this view too, and one of them may well have been ticked.
  select coalesce(sum(points), 0) into got from v_guess_scores where season_id = v_season;
  assert got = 0, format(
    'No guess has been ticked yet, so nothing may pay, got %s.', got);

  -- The GM ticks what came up. Madeleine in episode 1, croquembouche in
  -- episode 2, cake in episode 1.
  insert into guess_hits (season_id, guess_key, episode_id) values
    (v_season, 'madeleine',     ep1),
    (v_season, 'croquembouche', ep2),
    (v_season, 'cake',          ep1);

  select points into got from v_guess_scores where player_id = p1 and guess_key = 'madeleine';
  assert got = 5, format('The sole holder of a guess that comes up scores +5, got %s.', got);

  select points into got from v_guess_scores where player_id = p2 and guess_key = 'croquembouche';
  assert got = 2, format('One of exactly two holders scores +2, got %s.', got);
  select points into got from v_guess_scores where player_id = p3 and guess_key = 'croquembouche';
  assert got = 2, format('The other of exactly two holders scores +2 as well, got %s.', got);

  select points into got from v_guess_scores where player_id = p1 and guess_key = 'cake';
  assert got = 0, format(
    'Three holders is too many and pays nobody, got %s. This tier is the whole '
    'reason an obvious one-word guess is not worth taking.', got);

  -- ---- A GUESS PAYS ONCE -----------------------------------------------
  -- Not once per episode. The rule is the unique constraint on
  -- (season_id, guess_key), so assert that the constraint REFUSES rather than
  -- trusting the view to have summed correctly.
  begin
    insert into guess_hits (season_id, guess_key, episode_id)
      values (v_season, 'madeleine', ep2);
    assert false,
      'Madeleine already came up in episode 1. A second hit must be refused, or a '
      'guess pays again every week the bake reappears.';
  exception when unique_violation then
    null;
  end;

  select coalesce(sum(guess_points), 0) into got from v_episode_scores where player_id = p1;
  assert got = 5, format(
    'P1''s madeleine pays 5 ONCE across the whole series, got %s.', got);

  -- ---- FOLDED INTO THE WEEK IT LANDED ----------------------------------
  -- These points have an honest episode, unlike the top-three bonus, so they
  -- step the chart and move the table on the night.
  select guess_points into got from v_episode_scores where player_id = p1 and episode_id = ep1;
  assert got = 5, format('Madeleine came up in episode 1, so it pays in episode 1, got %s.', got);

  select points into got from v_episode_scores where player_id = p1 and episode_id = ep1;
  assert got = 16, format(
    'P1''s episode 1 is 11 from picks plus 5 from the guess = 16, got %s.', got);

  -- P2 never entered episode 2, so there is no entry row to hang this on. An
  -- entries-only spine would silently drop the points.
  select count(*) into got from entries where player_id = p2 and episode_id = ep2;
  assert got = 0, 'Fixture check: P2 is supposed to have no entry for episode 2.';

  select points into got from v_episode_scores where player_id = p2 and episode_id = ep2;
  assert got = 2, format(
    'P2 made no picks in episode 2, but their croquembouche came up in it and must '
    'still pay 2, got %s. If there is no row at all, v_episode_scores is still '
    'built on entries alone.', got);

  -- A guess that came up but paid nothing brings nobody in. Cake hit in episode
  -- 1 and was worth 0, and P3 holds cake but has no live entry that week — their
  -- episode-1 entry is disallowed.
  --
  -- THE SPINE ARMS PULL IN OPPOSITE DIRECTIONS HERE, which is the point of
  -- asserting it. P3 does have a row for episode 1, but the worthless guess is
  -- not what put it there — the -2 for having nothing in is. A 0 for somebody
  -- who sat the week out is noise and stays out; a -2 for somebody who missed it
  -- is the news and comes in. So the row exists and carries exactly the penalty,
  -- with nothing from the guess in it.
  select count(*) into got from v_episode_scores where player_id = p3 and episode_id = ep1;
  assert got = 1, format('P3 owes -2 for episode 1, so they have exactly one row for it, got %s.', got);

  select guess_points into got from v_episode_scores where player_id = p3 and episode_id = ep1;
  assert got = 0, format(
    'A guess worth nothing must contribute nothing, got %s.', got);

  select points into got from v_episode_scores where player_id = p3 and episode_id = ep1;
  assert got = -2, format(
    'P3''s episode 1 is the -2 and nothing else — no picks (disallowed) and no guess '
    '(too popular). Got %s.', got);

  -- ---- DISALLOWING ONE GUESS -------------------------------------------
  -- The GM's switch, and the only way a guess leaves scoring — RULES §6 leaves
  -- a VERY LATE guesser to be handled by hand, and this is the hand.
  --
  -- It must come out of the HOLDERS COUNT as well as the payout. If a struck
  -- guess still counted towards the tier, one disallowed row would quietly drop
  -- everybody else from +5 to +2, which is the opposite of "as if it were never
  -- made" (RULES §2.5).
  update series_guesses set is_disallowed = true
    where player_id = p3 and guess_key = 'croquembouche';

  select points into got from v_guess_scores where player_id = p2 and guess_key = 'croquembouche';
  assert got = 5, format(
    'With P3''s croquembouche struck out, P2 is the only holder left and scores +5, '
    'got %s. If it is still 2, disallowed guesses are being counted as holders.', got);

  select count(*) into got from v_guess_scores where player_id = p3 and guess_key = 'croquembouche';
  assert got = 0, format(
    'A disallowed guess must not appear in scoring at all, got %s row(s).', got);

  -- It stays on the public board, flagged, so it can be shown struck through —
  -- the same choice v_public_predictions makes for a disallowed entry.
  select count(*) into got from v_series_guesses_public
    where player_id = p3 and guess_key = 'croquembouche' and is_disallowed;
  assert got = 1, format(
    'A disallowed guess is still public and still flagged, so the board can strike '
    'it through rather than quietly dropping a row. Got %s.', got);

  -- Disallowing an ENTRY is a different switch from disallowing a GUESS. P3's
  -- episode-1 entry is struck out and scores nothing, but their guesses were
  -- never part of that entry.
  update series_guesses set is_disallowed = false
    where player_id = p3 and guess_key = 'croquembouche';

  select total_points into got from v_standings where player_id = p3;
  assert got = 0, format(
    'P3''s episode-1 entry is disallowed, so it pays 0 and costs 2; their croquembouche '
    'is a separate commitment and still pays 2. The two cancel to 0, got %s.', got);

  -- ---- HOLDERS ARE COUNTED PER LEAGUE ----------------------------------
  -- Seasons are shared by every league playing them (TECH_PLAN §2), so a
  -- season-wide count would let a stranger in another league — someone the
  -- player has never met and is not competing against — take their +5 away.
  insert into leagues (season_id, name, slug)
    values (v_season, 'Smoke Test League Two', 'smoke-test-league-two') returning id into v_league2;
  insert into players (league_id, display_name, code_norm, colour_hex)
    values (v_league2, 'P Four', 'smoketestfour', '#2a78d6') returning id into p4;
  insert into series_guesses (player_id, slot, guess_text, guess_key)
    values (p4, 1, 'Madeleine', 'madeleine');

  select points into got from v_guess_scores where player_id = p1 and guess_key = 'madeleine';
  assert got = 5, format(
    'P4 is in a different league, so P1 is still the only person in THEIRS holding '
    'madeleine and still scores +5, got %s. If it is 2, holders are being counted '
    'across the whole season instead of the league.', got);

  select points into got from v_guess_scores where player_id = p4 and guess_key = 'madeleine';
  assert got = 5, format(
    'P4 is the sole holder in their own league, so the same guess pays them +5 too, '
    'got %s.', got);

  -- ---- THE TWO WEEKS ARE DERIVED, NOT STORED ---------------------------
  -- Episode 7 was added to this season further up, which makes IT the final and
  -- episode 3 the semi-final. The bonus must have moved with them.
  --
  -- This is the cost of deriving the two moments rather than storing them, and
  -- it is asserted rather than merely documented so that it stays a known
  -- property: ADDING AN EPISODE TO A RUNNING SEASON MOVES THE BONUS. The real
  -- season seeds all ten up front, so it does not arise there.

  select bonus_points into got from v_episode_scores
   where player_id = p1 and episode_id = ep4;
  assert got = 6, format(
    'Episode 7 is now the highest-numbered episode, so the +6 must have followed '
    'it there. Got %s. If it is still on episode 3, the final is being stored '
    'somewhere rather than derived from the numbering.', coalesce(got, 0));

  select coalesce(sum(bonus_points), 0) into got from v_episode_scores
   where player_id = p1 and episode_id = ep2;
  assert got = 0, format(
    'Episode 2 is no longer the semi-final, so no bonus may still be sitting '
    'there. Got %s.', got);

  -- THE SAFETY PROPERTY, and the one to read first if this section fails:
  -- moving the bonus into the weeks must not change what anybody is ON. The
  -- standings total must be exactly the sum of the episode rows and nothing
  -- more — if v_standings is still adding v_series_bonus on top of episode
  -- points that now include it, everyone with a top three is paid twice.
  select (select coalesce(sum(points), 0) from v_episode_scores where player_id = p1)
       - (select total_points from v_standings where player_id = p1)
    into got;
  assert got = 0, format(
    'v_standings.total_points must equal the sum of that player''s v_episode_scores '
    'rows. The difference is %s. A difference of +12 means the bonus is being '
    'counted twice — once inside the episodes and again in v_standings.', got);

end $$;

rollback;

-- Reached only if every assertion above held — a failure aborts the script
-- before this line.
select 'SMOKE TEST PASSED — scoring, all three reveal gates, the three result states, the bake guess tiers and the two weeks the top-three bonus lands in all behave. Nothing was written.' as result;
