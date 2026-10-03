// ============================================================
// The numbers beside "Everyone's three"
// ============================================================
// Three counts over rows the board already has, so no query and no endpoint:
// how often each baker was named, which threes are shared, and how many of
// their three each player still has in the tent.
//
// NOTHING HERE IS A SCORING RULE. The bonus (+3 per finalist, +6 for the
// winner) is v_series_bonus_scores' business; this only counts names. "In" is
// read straight off `baker_status` as the view publishes it — anything not
// `eliminated`, so finalists and the winner are still in.
//
// THE ROWS ARE ALREADY THIS LEAGUE'S AND ALREADY GATED. v_top_picks_public
// carries no league_id; fetchLive filters it by the player ids v_standings
// supplies, and the view itself is empty until episode 2 airs (RULES §5). So
// every number here is about the room on screen, and none can leak early.
//
// Disallowed picks are dropped, to match `not tp.is_disallowed` in the SQL
// that pays the bonus: a pick the GM threw out is not a pick the room holds.

/**
 * @returns {null | {
 *   mentions: Array<{baker_id, name, gone, count}>,
 *   combos:   Array<{key, bakers: Array<{baker_id, name, gone}>, count}>,
 *   stillIn:  Array<{bakers: number, players: number}>,
 * }}
 */
export function topThreeStats(topPicks) {
  const live = (topPicks ?? []).filter((r) => !r.is_disallowed)
  if (live.length === 0) return null

  const byPlayer = new Map()
  const bakers = new Map()
  for (const r of live) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, [])
    byPlayer.get(r.player_id).push(r.baker_id)
    bakers.set(r.baker_id, {
      baker_id: r.baker_id,
      name: r.baker_name,
      gone: r.baker_status === 'eliminated',
    })
  }
  const byName = (a, b) => a.name.localeCompare(b.name)

  // ---- How often each baker was named. Most first, ties alphabetical.
  const tally = new Map()
  for (const r of live) tally.set(r.baker_id, (tally.get(r.baker_id) ?? 0) + 1)
  const mentions = [...tally.entries()]
    .map(([id, count]) => ({ ...bakers.get(id), count }))
    .sort((a, b) => b.count - a.count || byName(a, b))

  // ---- Shared threes. Rank is a slot, not a preference (RULES §5), so a three
  // is a set: sorted ids make the same three the same key whatever order it was
  // picked in. Only complete threes count — two names is not a combination.
  const comboCount = new Map()
  for (const ids of byPlayer.values()) {
    if (ids.length !== 3) continue
    const key = [...ids].sort().join(',')
    comboCount.set(key, (comboCount.get(key) ?? 0) + 1)
  }
  // Held by one person is just that person's three, and it is on the board
  // already. Two is the floor — the same rule as "The favourite" in stats.js.
  const shared = [...comboCount.entries()]
    .filter(([, n]) => n >= 2)
    .map(([key, count]) => ({
      key,
      count,
      bakers: key.split(',').map((id) => bakers.get(id)).sort(byName),
    }))
    .sort((a, b) => b.count - a.count || a.bakers[0].name.localeCompare(b.bakers[0].name))
  // The top three, and everything tied with the third: cutting a tie would pick
  // a winner at random, and the floor above keeps the list short regardless.
  const cutoff = shared[2]?.count ?? 0
  const combos = shared.filter((c, i) => i < 3 || c.count === cutoff)

  // ---- How many of their three each player still has in. Every bucket is
  // returned, empty ones too: "nobody is down to zero" is itself the news.
  const buckets = [3, 2, 1, 0].map((n) => ({ bakers: n, players: 0 }))
  for (const ids of byPlayer.values()) {
    const left = ids.filter((id) => !bakers.get(id).gone).length
    const bucket = buckets.find((b) => b.bakers === left)
    if (bucket) bucket.players += 1
  }

  return { mentions, combos, stillIn: buckets }
}
