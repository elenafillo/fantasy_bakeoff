// ============================================================
// Which episode, and which categories
// ============================================================
// The leading underscore keeps Vercel from routing this as an endpoint.
//
// Both panels answer these two questions and they must answer them the same
// way. If the GM panel defaulted to a different episode than the player panel
// shows, the GM would spend an episode entering results against the wrong week
// — on the night, at speed, with nothing on screen saying so.

import { rest } from './_supabase.js'

/**
 * The episode the panels are about: the lowest-numbered one not yet complete.
 *
 * Numbers rather than dates, because air dates are NULL until the schedule is
 * announced — ordering by a column that is entirely null would make the panel
 * pick an arbitrary episode for the first few weeks of the project's life.
 *
 * Takes a list rather than querying, so the GM panel — which has already loaded
 * every episode for its dropdown — applies the rule without a second round trip
 * and without a second copy of the rule.
 */
export function pickCurrent(episodes) {
  const byNumber = [...episodes].sort((a, b) => a.number - b.number)
  const open = byNumber.find((e) => e.status !== 'complete')
  // Series over: show the final rather than nothing.
  return open ?? byNumber[byNumber.length - 1] ?? null
}

export async function currentEpisode(seasonId) {
  return pickCurrent(
    await rest('episodes', `select=*&season_id=eq.${seasonId}&order=number.asc`)
  )
}

/** The categories that apply to this episode. The final has its own card. */
export function categoriesFor(categories, episode) {
  const want = episode.is_final ? 'final' : 'regular'
  return categories.filter((c) => c.applies_to === 'both' || c.applies_to === want)
}
