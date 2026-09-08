// ============================================================
// The dashboard's data
// ============================================================
// Every query here is a granted view read with the publishable key. There is no
// endpoint and there must not be one: the dashboard is meant to sit on a screen
// all evening with eight phones refreshing it, and that costs zero Vercel
// invocations only for as long as it never touches /api (TECH_PLAN §6, §8).
//
// The one exception is `recoverWho` below, which runs at most once per device,
// never on a poll, and only for a browser that logged in before playerApi.js
// started caching the answer.
//
// THE PREDICTION WALL IS SUPPOSED TO BE EMPTY BEFORE THE DEADLINE. It reads
// v_public_predictions, whose WHERE clause is the whole of "nobody sees your
// picks early":
//
//   where ep.deadline_at is not null    -- no deadline set = not public
//     and ep.deadline_at <= now();
//
// Episodes are seeded with no date, so an empty wall is the normal state of
// this project today and is the system working. Never read `predictions` or
// `entries` to fill it in, and never add a view that does without that gate.

import { supabase } from './supabase.js'
import { playerPost, rememberWho, storedCode, storedWho } from './playerApi.js'

// ------------------------------------------------------------
// Which episode, and which categories
// ------------------------------------------------------------
/**
 * THESE TWO ARE A SECOND COPY of `pickCurrent` and `categoriesFor` in
 * api/_episodes.js. That file's header explains why the rule may only have one
 * answer — if `/play` and `/` disagreed about which week it is, the panel would
 * be taking picks for one episode while the dashboard scored another, on the
 * night, with nothing on screen saying so.
 *
 * The dashboard cannot import that file: it pulls in api/_supabase.js, and with
 * it SUPABASE_SERVICE_ROLE_KEY, which must never appear in the browser bundle.
 * So this is a deliberate duplicate of three lines rather than a shared module,
 * and the contract is a comment in both places: **change one, change the
 * other.**
 */
export function pickCurrent(episodes) {
  const byNumber = [...episodes].sort((a, b) => a.number - b.number)
  const open = byNumber.find((e) => e.status !== 'complete')
  // Series over: show the final rather than nothing.
  return open ?? byNumber[byNumber.length - 1] ?? null
}

/** The categories that apply to this episode. The final has its own card. */
export function categoriesFor(categories, episode) {
  if (!episode) return []
  const want = episode.is_final ? 'final' : 'regular'
  return categories.filter((c) => c.applies_to === 'both' || c.applies_to === want)
}

// ------------------------------------------------------------
// Which league
// ------------------------------------------------------------
/**
 * In order: an explicit `/league/<slug>`, then the league belonging to the code
 * in localStorage, then the one flagged `is_default` (TECH_PLAN §5).
 *
 * Every league is fetched rather than filtered on, because the answer needs two
 * of them: the one being shown, and the viewer's own, so the page can say
 * quietly that they are not the same. v_leagues_public is a handful of rows.
 */
export async function resolveLeague(slug) {
  const leagues = await supabase.query('v_leagues_public', {
    select: 'id,season_id,name,slug,is_default',
    order: 'name.asc',
  })

  const who = storedWho() ?? (await recoverWho())
  const yours = who ? leagues.find((l) => l.slug === who.leagueSlug) ?? null : null
  const asked = slug ? leagues.find((l) => l.slug === slug) ?? null : null

  return {
    league: asked ?? yours ?? leagues.find((l) => l.is_default) ?? leagues[0] ?? null,
    yours,
    you: who?.playerId ?? null,
    // An explicit slug that matches nothing. Worth saying out loud rather than
    // silently showing the default league, because the URL was somebody's
    // deliberate choice — usually a league put on a screen in another room.
    missing: Boolean(slug) && !asked,
  }
}

/**
 * The one /api/player call this page can make, and the conditions are narrow:
 * a code is stored, nothing is cached against it, and this is the first load.
 * It never runs on a poll and it caches its answer, so it costs one invocation
 * in the lifetime of a browser — spent only by devices that logged in before
 * /play started remembering. A failure is silent: an unknown code just means
 * falling through to the default league.
 */
async function recoverWho() {
  const code = storedCode()
  if (!code) return null
  try {
    const state = await playerPost('state', code)
    const who = { playerId: state.player.id, leagueSlug: state.league.slug }
    rememberWho(who)
    return who
  } catch {
    return null
  }
}

// ------------------------------------------------------------
// Reference data — fetched once
// ------------------------------------------------------------
/**
 * Categories and baker names. Neither changes during an episode, so they sit
 * outside the poll: /bakers fetches once for the same reason (TECH_PLAN §8).
 * A baker renamed mid-evening needs a reload, which is the right trade for
 * dropping v_baker_stats — a view of twelve correlated subqueries — out of a
 * loop that runs every four seconds.
 *
 * Names come from v_baker_stats because that is the only granted view that
 * publishes every baker's name. v_episode_results_public carries names too, but
 * only for the bakers who won something, and the wall has to name the bakers
 * people picked.
 */
export async function fetchReference(league) {
  const [categories, bakers] = await Promise.all([
    supabase.query('v_categories_public', {
      select: 'key,label,points,sort_order,applies_to',
      order: 'sort_order.asc',
    }),
    supabase.query('v_baker_stats', {
      // picked_leaving feeds the stats strip's "written off, still here". It
      // sits in the once-only fetch rather than the poll because it can only
      // change when a deadline passes — a weekly event, not a live one — and
      // v_baker_stats is twelve correlated subqueries.
      select: 'baker_id,name,status,eliminated_episode,picked_leaving',
      params: { season_id: `eq.${league.season_id}` },
    }),
  ])

  return {
    categories,
    bakers,
    bakerNames: Object.fromEntries(bakers.map((b) => [b.baker_id, b.name])),
  }
}

// ------------------------------------------------------------
// The live half — everything the poll re-reads
// ------------------------------------------------------------
/**
 * Two waves, because three of these views carry no league_id and have to be
 * filtered by the player ids that only v_standings can supply.
 *
 * That filter is not a nicety. Seasons are shared across leagues by design
 * (TECH_PLAN §2), so v_episode_scores and v_public_predictions both hold rows
 * for players in every league running this series. Dropping the player filter
 * would put a stranger's picks on this league's wall.
 */
export async function fetchLive(league) {
  const [episodes, standings, results] = await Promise.all([
    supabase.query('v_episodes_public', {
      select: 'id,number,theme,air_date,deadline_at,live_at,bingo_prompt,status,is_final,predictions_public',
      params: { season_id: `eq.${league.season_id}` },
      order: 'number.asc',
    }),
    supabase.query('v_standings', {
      select:
        'player_id,display_name,colour_hex,avatar_config,' +
        'episode_points,bonus_points,total_points,correct_total,position',
      params: { league_id: `eq.${league.id}` },
      order: 'position.asc,display_name.asc',
    }),
    // The whole season in one query — v_episode_results_public carries
    // season_id for exactly this, and it feeds both this week's grid and the
    // recap. Results are NOT deadline-gated: a result is a fact about a
    // broadcast episode, not a pick.
    supabase.query('v_episode_results_public', {
      select: 'episode_id,category,baker_id,baker_name,voided',
      params: { season_id: `eq.${league.season_id}` },
    }),
  ])

  // Named `currentEpisode` rather than `current` on purpose: React's compiler
  // reads a `.current` property as a ref access, and quietly gives up on
  // memoising anything that touches one.
  const currentEpisode = pickCurrent(episodes)
  const ids = standings.map((r) => r.player_id)
  const inLeague = `in.(${ids.join(',')})`

  const [scores, predictions, topPicks] = await Promise.all([
    ids.length
      ? supabase.query('v_episode_scores', {
          select:
            'player_id,episode_id,episode_number,points,pick_points,penalty_points,' +
            'correct_count,picks_made,lateness,penalties',
          params: { player_id: inLeague },
        })
      : [],
    ids.length && currentEpisode
      ? supabase.query('v_public_predictions', {
          select: 'player_id,episode_id,category,baker_id,lateness,is_disallowed,confirmed',
          params: { episode_id: `eq.${currentEpisode.id}`, player_id: inLeague },
        })
      : [],
    // Empty until episode 2's deadline, by design — v_top_picks_public applies
    // the same fail-closed gate as v_public_predictions, on episode 2's clock
    // (RULES §5). The board says which of the two reasons applies rather than
    // showing a blank, exactly as the prediction wall does.
    //
    // The player filter is load-bearing here for the same reason as above: this
    // view carries no league_id and holds rows for every league in the season.
    ids.length
      ? supabase.query('v_top_picks_public', {
          select: 'player_id,baker_id,baker_name,baker_status,rank',
          params: { player_id: inLeague },
          order: 'rank.asc',
        })
      : [],
  ])

  return { episodes, currentEpisode, standings, results, scores, predictions, topPicks }
}

// ------------------------------------------------------------
// The chart's numbers
// ------------------------------------------------------------
/**
 * Each player's running total, episode by episode.
 *
 * This adds up points, which is worth being precise about: it adds up numbers
 * SQL has already worked out, and it applies no rule. Nothing here decides what
 * a category is worth, what counts as correct, how a week with two winners pays
 * or when a penalty fires — v_episode_scores did all of that. It is the same
 * arithmetic movementFor already does in scores.js, and for the same reason:
 * the running total is a fact about ordering points in time, and no view
 * carries it.
 *
 * A player with no entry for an episode has no row, so their line runs flat
 * across it rather than dropping to zero or leaving a gap — which is why
 * v_episode_scores is built on entries rather than on predictions.
 *
 * SERIES BONUSES ARE NOT ON THE LINE. v_series_bonus carries no episode, so
 * there is no honest week to attach +3s and +6s to — the same reason
 * movementFor carries them across rather than counting them as this week's
 * news. The leaderboard total includes them and the chart says so when they
 * are non-zero. Worth revisiting in phase 6, when top-three picks exist and
 * this stops being theoretical.
 */
export function seriesFor({ standings, scores }) {
  const last = scores.reduce((max, s) => Math.max(max, s.episode_number), 0)
  if (last === 0) return { last: 0, series: [] }

  const series = standings.map((player) => {
    const mine = new Map(
      scores.filter((s) => s.player_id === player.player_id).map((s) => [s.episode_number, s.points])
    )

    let total = 0
    // Episode 0 is the start line, so every line begins at zero rather than at
    // whatever the first week happened to pay.
    const points = [{ n: 0, total: 0 }]
    for (let n = 1; n <= last; n += 1) {
      total += mine.get(n) ?? 0
      points.push({ n, total })
    }

    return { player, points, total }
  })

  return { last, series }
}
