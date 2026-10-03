// ============================================================
// The stats strip's numbers
// ============================================================
// Five things worth knowing, built from data the dashboard has already fetched.
// No extra queries and no endpoint.
//
// NOTHING HERE IS A SCORING RULE. Every number below is either counted from
// rows SQL already decided (v_episode_scores' points, v_public_predictions'
// picks) or worked out with `verdictFor` — the single
// derivation the browser is allowed, and the same one the scorecard and the
// wall use. If a stat ever needs to know what a category is worth, or when a
// penalty fires, it belongs in views.sql instead. See TECH_PLAN §2.
//
// EVERY CARD IS ABOUT THE LEAGUE ON SCREEN, and that holds only because the
// rows arrive pre-filtered: v_episode_scores and v_public_predictions carry no
// league_id, so fetchLive filters both by the player ids v_standings supplies
// (its header explains why that filter is load-bearing). "Written off" was the
// exception until TECH_PLAN Still-open #10 was settled — it read
// v_baker_stats.picked_leaving, which is keyed on the baker and counts every
// league playing the season. No card may go back to a per-baker count.
//
// Every builder returns null when it has nothing to say, and the strip renders
// only what came back. Before the first result that is all of them, which is
// correct: an empty stat is not a stat reading zero.

import { verdictFor, nameList } from './scores.js'

/**
 * @returns {Array<{key, label, value, detail}>}
 */
export function buildStats({
  predictions, results, scores, standings, bakerNames, bakers, seriesPicks, episode,
}) {
  const names = Object.fromEntries(standings.map((p) => [p.player_id, p.display_name]))
  const live = (predictions ?? []).filter((p) => !p.is_disallowed)
  const thisWeek = (results ?? []).filter((r) => r.episode_id === episode?.id)
  // Disallowed picks are dropped once, here, to match the `live` filter above
  // and `en.is_disallowed is false` in the SQL: an entry the GM threw out is not
  // an opinion the room held, nor a call anyone made.
  const series = (seriesPicks ?? []).filter((p) => !p.is_disallowed)

  // Bakers first, then players. The two halves answer different questions —
  // "what is the tent doing" and "who among us is any good at reading it" —
  // and mixing them made the strip read as five unrelated facts.
  return [
    favourite(live, bakerNames),
    writtenOff(bakers, series.filter((p) => p.category === 'leaving')),
    loneCall(live, thisWeek, names),
    biggestWeek(scores, names),
    sharpest(series, results ?? [], names),
  ].filter(Boolean)
}

// ------------------------------------------------------------
/** Who the room is backing for Star Baker this week. */
function favourite(predictions, bakerNames) {
  const best = predictions.filter((p) => p.category === 'best')
  if (best.length < 2) return null

  const tally = new Map()
  for (const p of best) tally.set(p.baker_id, (tally.get(p.baker_id) ?? 0) + 1)

  const top = Math.max(...tally.values())
  // A "favourite" that everyone picked differently is not a favourite. One vote
  // each says the room has no opinion, which is worth not dressing up as one.
  if (top < 2) return null

  const tied = [...tally.entries()].filter(([, n]) => n === top).map(([id]) => bakerNames[id] ?? '—')
  return {
    key: 'favourite',
    label: 'The favourite',
    value: nameList(tied.sort()),
    detail: `${top} of ${best.length} called ${tied.length > 1 ? 'one of them' : 'it'} for Star Baker`,
  }
}

// ------------------------------------------------------------
/**
 * Something exactly one person got right this week — the stat people actually
 * want, because being the only one who saw it coming is the whole feeling the
 * game is for.
 */
function loneCall(predictions, thisWeek, names) {
  if (thisWeek.length === 0) return null

  const found = []
  for (const category of new Set(predictions.map((p) => p.category))) {
    const correct = predictions.filter(
      (p) => p.category === category && verdictFor(category, p.baker_id, thisWeek).state === 'right'
    )
    if (correct.length === 1) {
      const winners = verdictFor(category, correct[0].baker_id, thisWeek).winners
      found.push({
        player: names[correct[0].player_id] ?? 'Someone',
        category,
        baker: winners.find((w) => w.baker_id === correct[0].baker_id)?.baker_name ?? '',
      })
    }
  }
  if (found.length === 0) return null

  // Several lone calls in a week is possible and worth saying so, but the card
  // names one — the others are on the wall a screen above.
  const pick = found[0]
  return {
    key: 'lone',
    label: 'Lone call',
    value: pick.player,
    detail:
      `the only one to call ${CATEGORY_WORDS[pick.category] ?? pick.category}` +
      (pick.baker ? ` — ${pick.baker}` : '') +
      (found.length > 1 ? `, and ${found.length - 1} more like it` : ''),
  }
}

const CATEGORY_WORDS = {
  best: 'Star Baker',
  leaving: 'who went home',
  technical: 'the technical',
  bingo: 'the bingo',
  handshake: 'the handshake',
  winner: 'the winner',
}

// ------------------------------------------------------------
/** The best single week anyone has had. */
function biggestWeek(scores, names) {
  const rows = (scores ?? []).filter((s) => s.points > 0)
  if (rows.length === 0) return null

  const top = Math.max(...rows.map((s) => s.points))
  const who = rows.filter((s) => s.points === top)
  const episodes = [...new Set(who.map((s) => s.episode_number))].sort((a, b) => a - b)

  return {
    key: 'haul',
    label: 'Biggest week',
    value: `${top} pts`,
    detail:
      nameList([...new Set(who.map((s) => names[s.player_id] ?? 'Someone'))].sort()) +
      `, episode ${episodes.join(' & ')}`,
  }
}

// ------------------------------------------------------------
/**
 * The baker everyone keeps burying who is still in the tent — counted from
 * THIS LEAGUE's picks.
 *
 * It read `v_baker_stats.picked_leaving` until TECH_PLAN Still-open #10 was
 * settled. That column is keyed on the baker and has no league filter, so with
 * two leagues on one season both dashboards showed the same number and neither
 * was about the room reading it. Fixing it in SQL would have meant a view keyed
 * the wrong way and a permission-boundary paste; this is a tally instead —
 * exactly the shape `favourite` above already had.
 *
 * `leavingPicks` is every allowed 'leaving' pick in the league, across the
 * series, already scoped by fetchLive's player filter and already gated by
 * v_public_predictions. So this counts rows, and decides nothing.
 */
function writtenOff(bakers, leavingPicks) {
  const tally = new Map()
  for (const p of leavingPicks) tally.set(p.baker_id, (tally.get(p.baker_id) ?? 0) + 1)

  const count = (b) => tally.get(b.baker_id) ?? 0
  const survivors = (bakers ?? []).filter((b) => b.status !== 'eliminated' && count(b) > 0)
  if (survivors.length === 0) return null

  const top = Math.max(...survivors.map(count))
  // Once is not a story. Twice is.
  if (top < 2) return null

  const who = survivors.filter((b) => count(b) === top).map((b) => b.name)
  return {
    key: 'survivor',
    label: 'Written off',
    value: nameList(who.sort()),
    detail: `predicted to leave ${top} times — still here`,
  }
}

// ------------------------------------------------------------
/**
 * Best hit rate across the series, out of the picks that COULD have landed.
 *
 * A pick counts only once its category, that episode, has a winner — verdictFor
 * says 'right' or 'wrong'. So a handshake pick in a week with no handshake, a
 * bingo nobody hit, or a 'leaving' pick in a week nobody went ('nobody') is
 * not held against anyone; nor is a category still to be decided ('pending'),
 * which is what stops every rate dipping through the live hour as the picks
 * are revealed before the results land. Elena's call: every category, not
 * just bingo and the handshake — one rule, no category named in code.
 *
 * This used to read v_episode_scores' correct_count and picks_made, and
 * picks_made counts every pick made. The numerator moved with the denominator,
 * so both come from the same rows and cannot disagree. Still no scoring rule:
 * verdictFor is the one derivation the browser is allowed, and no points are
 * involved.
 */
function sharpest(picks, results, names) {
  const byEpisode = new Map()
  for (const r of results) {
    if (!byEpisode.has(r.episode_id)) byEpisode.set(r.episode_id, [])
    byEpisode.get(r.episode_id).push(r)
  }

  const totals = new Map()
  for (const p of picks) {
    const { state } = verdictFor(p.category, p.baker_id, byEpisode.get(p.episode_id) ?? [])
    if (state !== 'right' && state !== 'wrong') continue
    const row = totals.get(p.player_id) ?? { correct: 0, made: 0 }
    row.made += 1
    if (state === 'right') row.correct += 1
    totals.set(p.player_id, row)
  }

  // One good week is luck. A full episode's worth of picks is the floor at
  // which a percentage stops being noise — counted in picks that could land,
  // so a week with no handshake brings the card on a little later.
  const eligible = [...totals.entries()].filter(([, r]) => r.made >= 5)
  if (eligible.length === 0) return null

  const rate = ([, r]) => r.correct / r.made
  const top = Math.max(...eligible.map(rate))
  if (top === 0) return null

  const who = eligible.filter((e) => rate(e) === top)
  const { correct, made } = who[0][1]

  return {
    key: 'sharpest',
    label: 'Sharpest eye',
    value: `${Math.round(top * 100)}%`,
    detail:
      nameList(who.map(([id]) => names[id] ?? 'Someone').sort()) +
      `, ${correct} of ${made} picks that could land`,
  }
}
