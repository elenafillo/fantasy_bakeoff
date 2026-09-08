// ============================================================
// The stats strip's numbers
// ============================================================
// Five things worth knowing, built from data the dashboard has already fetched.
// No extra queries and no endpoint.
//
// NOTHING HERE IS A SCORING RULE. Every number below is either counted from
// rows SQL already decided (v_episode_scores' points and correct_count,
// v_baker_stats' picked_leaving) or worked out with `verdictFor` — the single
// derivation the browser is allowed, and the same one the scorecard and the
// wall use. If a stat ever needs to know what a category is worth, or when a
// penalty fires, it belongs in views.sql instead. See TECH_PLAN §2.
//
// Every builder returns null when it has nothing to say, and the strip renders
// only what came back. Before the first result that is all of them, which is
// correct: an empty stat is not a stat reading zero.

import { verdictFor, nameList } from './scores.js'

/**
 * @returns {Array<{key, label, value, detail}>}
 */
export function buildStats({ predictions, results, scores, standings, bakerNames, bakers, episode }) {
  const names = Object.fromEntries(standings.map((p) => [p.player_id, p.display_name]))
  const live = (predictions ?? []).filter((p) => !p.is_disallowed)
  const thisWeek = (results ?? []).filter((r) => r.episode_id === episode?.id)

  // Bakers first, then players. The two halves answer different questions —
  // "what is the tent doing" and "who among us is any good at reading it" —
  // and mixing them made the strip read as five unrelated facts.
  return [
    favourite(live, bakerNames),
    writtenOff(bakers),
    loneCall(live, thisWeek, names),
    biggestWeek(scores, names),
    sharpest(scores, names),
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
 * The baker everyone keeps burying who is still in the tent.
 *
 * `picked_leaving` counts across EVERY league playing the season, because
 * v_baker_stats is keyed on the baker and has no league filter (TECH_PLAN §5).
 * With one league running they are the same number.
 */
function writtenOff(bakers) {
  const survivors = (bakers ?? []).filter((b) => b.status !== 'eliminated' && b.picked_leaving > 0)
  if (survivors.length === 0) return null

  const top = Math.max(...survivors.map((b) => b.picked_leaving))
  // Once is not a story. Twice is.
  if (top < 2) return null

  const who = survivors.filter((b) => b.picked_leaving === top).map((b) => b.name)
  return {
    key: 'survivor',
    label: 'Written off',
    value: nameList(who.sort()),
    detail: `predicted to leave ${top} times — still here`,
  }
}

// ------------------------------------------------------------
/**
 * Best hit rate across the series. `correct_count` and `picks_made` both come
 * from v_episode_scores, so this counts rows and does not judge any of them.
 */
function sharpest(scores, names) {
  const totals = new Map()
  for (const s of scores ?? []) {
    const row = totals.get(s.player_id) ?? { correct: 0, made: 0 }
    row.correct += s.correct_count
    row.made += s.picks_made
    totals.set(s.player_id, row)
  }

  // One good week is luck. A full episode's worth of picks is the floor at
  // which a percentage stops being noise.
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
      `, ${correct} of ${made} picks`,
  }
}
