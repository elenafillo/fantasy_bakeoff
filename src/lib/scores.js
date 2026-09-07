// ============================================================
// The scoring snapshot — what happened, and where everybody stands
// ============================================================
// Read straight from the granted views with the publishable key, not through a
// serverless function: eight phones refreshing all evening then costs zero
// Vercel invocations (TECH_PLAN §6, §8).
//
// THE RULE THIS FILE EXISTS TO KEEP: **points always come from SQL.** Scoring
// lives in supabase/views.sql, once, so the dashboard, the leaderboard and the
// player's own panel cannot disagree — which is exactly the failure mode of
// computing the same rules in JavaScript in three places (TECH_PLAN §3).
//
// So nothing here adds up a category's points, handles a multi-winner category
// or applies the two −1 penalties. v_episode_scores has already done all of
// that. The browser derives exactly one thing, in `verdictFor` below: whether
// the baker you named is one of the bakers who won it. That comparison is
// trivial, it is display, and it is not a rule.
//
// v_prediction_scores and v_penalties — the views that would let this file
// cheat — are deliberately ungranted (rls.sql). That is the boundary.

import { supabase } from './supabase.js'

/**
 * Everything the player panel needs to show how a week went.
 *
 * Two round trips, because v_episode_scores carries no league_id and the
 * player list therefore has to come out of v_standings first. Both are
 * anon-readable by design — this is the same data the dashboard puts on a
 * screen in the middle of the room.
 */
export async function fetchScoreboard({ episodeId, episodeNumber, leagueId, playerId }) {
  const [results, table] = await Promise.all([
    // No rows for a category means "not decided yet". That absence is
    // information, and it is why nothing here fills gaps in with zeroes.
    supabase.query('v_episode_results_public', {
      select: 'category,baker_id,baker_name,voided',
      params: { episode_id: `eq.${episodeId}` },
    }),
    supabase.query('v_standings', {
      select: 'player_id,total_points,episode_points,bonus_points,correct_total,position',
      params: { league_id: `eq.${leagueId}` },
    }),
  ])

  const ids = table.map((r) => r.player_id)
  const perEpisode = ids.length
    ? await supabase.query('v_episode_scores', {
        select:
          'player_id,episode_id,episode_number,points,pick_points,penalty_points,' +
          'correct_count,picks_made,penalties',
        params: { player_id: `in.(${ids.join(',')})` },
      })
    : []

  const mine = table.find((r) => r.player_id === playerId) ?? null

  return {
    results,
    // The standings row and the week's row, both straight from SQL.
    mine,
    week: perEpisode.find((r) => r.player_id === playerId && r.episode_id === episodeId) ?? null,
    // v_standings uses rank(), so ties share a position and the sequence then
    // skips: 1, 1, 3. Saying "joint 2nd" is what stops two people both reading
    // "2nd" as an error. RULES §6's tiebreak is applied by a human at the end
    // of the series, deliberately not in code.
    joint: mine ? table.filter((r) => r.position === mine.position).length > 1 : false,
    movement: movementFor({ table, perEpisode, playerId, episodeNumber }),
  }
}

/**
 * How far you moved this week: positive is up the table, 0 is holding station,
 * null is "there is nothing to compare against yet".
 *
 * v_standings knows only where you stand now, so last week's table has to be
 * rebuilt: everyone's points from the episodes *before* this one, plus their
 * series bonus, re-ranked the same way SQL ranks.
 *
 * The bonus is carried across rather than treated as this week's news, because
 * v_series_bonus has no episode attached — it is a fact about the series, and
 * there is no honest way to say which week it landed in. The consequence, worth
 * knowing before the final: the top-three bonuses appear in both tables, so
 * they produce no movement of their own.
 */
export function movementFor({ table, perEpisode, playerId, episodeNumber }) {
  const earlier = perEpisode.filter((s) => s.episode_number < episodeNumber)
  // Week one, or the first week anybody scored: every previous total is zero,
  // so a re-rank would put the whole league joint first and report everyone
  // below the leader as having fallen. Better to say nothing.
  if (earlier.length === 0) return null

  const before = rankBy(
    table.map((row) => ({
      player_id: row.player_id,
      total:
        row.bonus_points +
        earlier
          .filter((s) => s.player_id === row.player_id)
          .reduce((sum, s) => sum + s.points, 0),
    }))
  )

  const now = table.find((r) => r.player_id === playerId)?.position
  const then = before.get(playerId)
  if (now == null || then == null) return null
  return then - now
}

/**
 * rank() as Postgres does it: sort descending, ties share a position, and the
 * sequence then skips — 1, 1, 3. Matching v_standings matters, because the two
 * numbers get subtracted from each other.
 */
function rankBy(rows) {
  const sorted = [...rows].sort((a, b) => b.total - a.total)
  const out = new Map()
  sorted.forEach((row, i) => {
    const previous = sorted[i - 1]
    out.set(row.player_id, previous && previous.total === row.total ? out.get(previous.player_id) : i + 1)
  })
  return out
}

/**
 * The one thing the browser works out for itself: did the baker you named win
 * it? Four states, and the first two must never be shown alike.
 *
 *   pending   no result rows           not decided yet — plainly blank
 *   nobody    a voided row             Nobody won it — hatched, struck out
 *   right     your pick is a winner    tick
 *   wrong     it isn't                 cross, and what the answer actually was
 *
 * `nopick` is the fifth: the category was settled and you never named anyone.
 *
 * Winner rows beat a void row if both somehow exist. That is not a preference —
 * it is the direction v_prediction_scores fails in (it filters on `not voided`),
 * and a display that disagreed with the scoring would be worse than either.
 */
export function verdictFor(category, pickId, results) {
  const rows = results.filter((r) => r.category === category)
  if (rows.length === 0) return { state: 'pending', winners: [] }

  const winners = rows.filter((r) => !r.voided)
  if (winners.length === 0) return { state: 'nobody', winners: [] }
  if (!pickId) return { state: 'nopick', winners }

  return {
    state: winners.some((w) => w.baker_id === pickId) ? 'right' : 'wrong',
    winners,
  }
}

/** "Priya", "Priya and Mo", "Priya, Mo and Sam". */
export function nameList(names) {
  const clean = names.filter(Boolean)
  if (clean.length === 0) return ''
  if (clean.length === 1) return clean[0]
  return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`
}

export function ordinal(n) {
  if (n == null) return ''
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** "2nd", or "joint 2nd" when rank() has handed the position to more than one. */
export function positionLabel(position, joint) {
  if (position == null) return ''
  return joint ? `joint ${ordinal(position)}` : ordinal(position)
}
