// ============================================================
// POST /api/player — everything a player does
// ============================================================
// Actions: login · state · savePicks · saveTopPicks · confirm
//
// savePicks carries THREE things, not one: the week's predictions, and — while
// episode 1 is still open — the two bake guesses. They travel together so that
// there is one set of lateness and lock rules rather than two that can drift
// (RULES §6).
//
// Every call carries the player's two-word code and every call re-verifies it.
// There is no session and no token: the code IS the credential, so a request
// without a valid one gets nothing. That also means no session can go stale
// when the GM changes somebody's code.
//
// This endpoint exists because the browser cannot be trusted with any of it:
//   * predictions are RLS-denied to anon, so this is the only way a player
//     reads their own before the deadline;
//   * lateness is computed HERE from the server clock — a client that lies
//     about the time would otherwise mark itself on time;
//   * the lock after an episode starts airing is enforced HERE, because a
//     disabled button is not a rule.

import { rest, restInsert, restPatch, restDelete, jsonBody, isUuid } from './_supabase.js'
import { normaliseCode } from './_codes.js'
import { currentEpisode, categoriesFor } from './_episodes.js'
import { normaliseGuess, GUESS_MAX, GUESS_SLOTS } from './_guesses.js'

// The statuses a player can still be picked in. 'finalist' and 'winner' stay
// pickable, which is what makes the final's card work. Written once because
// buildState and savePicks must agree: the picker would otherwise offer a baker
// the save then refuses, or hide one it would have accepted.
const PICKABLE = ['active', 'finalist', 'winner']

// The top three ride on episode 2, and everything about them is derived from
// it: RULES §5 opens the picks when episode 1 finishes and locks them at 18:00
// on the Tuesday before episode 2 — which is episode 2's own deadline, to the
// second. So the lock here is lockState() against episode 2, the same function
// the weekly picks use, and the reveal in v_top_picks_public is episode 2's
// `deadline_at`. One date, derived from `air_date` by the trigger in
// schema.sql, and no way for the two ends to disagree.
//
// `season_settings.top_picks_lock_at` used to store that moment separately and
// is now dead — see the warning on it in schema.sql.
const TOP_PICKS_EPISODE = 2
const TOP_PICKS_COUNT = 3

// The bake guess rides on episode 1 the way the top three rides on episode 2,
// and for the opposite reason: the top three needs you to have watched everyone
// bake once, and this needs you to have watched nothing at all. A teaser can
// only spoil the next episode, so a commitment made before any of them is
// structurally unspoilable (RULES §6, TECH_PLAN §14).
//
// It therefore locks on episode 1's ordinary ladder — the same lockState call
// the weekly picks make, with the same door — and it is saved through savePicks
// rather than through an action of its own, so there is exactly one set of
// lateness rules to keep in step.
const GUESS_EPISODE = 1

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })

  const body = jsonBody(req)
  if (!body) return res.status(400).json({ error: 'Malformed JSON body.' })

  const { action, code } = body

  const norm = normaliseCode(code)
  if (!norm) return res.status(400).json({ error: 'Enter your two-word code.' })

  try {
    const player = await findPlayer(norm)
    if (!player) {
      // A small delay on failure. The wordlists are public and there are only
      // ~1,200 combinations, so this slows a script down rather than stopping
      // one — see supabase/README.md. It is a party game among friends, and
      // the honest mitigation is that codes are cheap to reissue.
      await new Promise((r) => setTimeout(r, 400))
      return res.status(401).json({ error: "That code doesn't match anyone." })
    }

    switch (action) {
      case 'login':
      case 'state':
        return res.status(200).json(await buildState(player))

      case 'savePicks':
        return await savePicks(res, player, body)

      case 'saveTopPicks':
        return await saveTopPicks(res, player, body)

      case 'confirm':
        return await confirm(res, player, body)

      default:
        return res.status(400).json({ error: `Unknown action "${action}".` })
    }
  } catch (err) {
    console.error('[api/player]', err)
    return res.status(500).json({ error: err.message })
  }
}

// ------------------------------------------------------------
// Lookup
// ------------------------------------------------------------

async function findPlayer(norm) {
  const rows = await rest(
    'players',
    `select=id,display_name,colour_hex,avatar_config,is_gm,league_id,leagues(id,name,slug,season_id)` +
      `&code_norm=eq.${encodeURIComponent(norm)}&limit=1`
  )
  return rows[0] ?? null
}

// ------------------------------------------------------------
// The lock and lateness rules — RULES §2.4 and §2.5
// ------------------------------------------------------------
/**
 * Returns either { locked: true, reason } or { lateness }.
 *
 *   before the deadline ................................ on_time
 *   after the deadline, before it airs ................. late
 *   after it starts airing, GM has opened the door ..... very_late
 *   after it starts airing, GM has not ................. LOCKED
 *
 * A NULL deadline (schedule unannounced) means nobody can be late yet, which
 * is the same fail-closed reasoning as the deadline gate in views.sql — except
 * here it fails *open*, deliberately: locking players out of an episode that
 * has no date would be the wrong way round.
 */
function lockState(episode, entry, now) {
  if (episode.status === 'complete') {
    return { locked: true, reason: 'That episode is over.' }
  }

  const live = episode.live_at ? new Date(episode.live_at) : null
  if (live && now >= live) {
    if (entry?.gm_unlocked_at) return { lateness: 'very_late' }
    return {
      locked: true,
      reason: 'The episode has started, so the panel is closed. Ask the GM to open it for you.',
    }
  }

  const deadline = episode.deadline_at ? new Date(episode.deadline_at) : null
  if (deadline && now >= deadline) return { lateness: 'late' }

  return { lateness: 'on_time' }
}

// ------------------------------------------------------------
// The top three — RULES §5
// ------------------------------------------------------------
/**
 * Everything the panel needs about the once-per-series pick, resolved against
 * episode 2 (see TOP_PICKS_EPISODE above).
 *
 * The window is open between episode 1 being marked complete — "after you have
 * seen everyone bake once" — and episode 2's lock, which is the ordinary
 * lateness ladder: on time, LATE after the deadline, VERY LATE only if the GM
 * opened that player's episode-2 door, and shut otherwise. One door-opening
 * therefore covers both their episode-2 picks and their three, which is the
 * right behaviour: it is one conversation with the GM, not two.
 *
 * `picks` is the player's OWN three and is returned whatever the clock says —
 * this endpoint is authenticated by the code, and you may always see your own.
 * Everyone else's stays behind v_top_picks_public until episode 2's deadline.
 */
async function topThreeState(player, seasonId, currentEp, currentEntry, now) {
  const [episodes, picks] = await Promise.all([
    rest(
      'episodes',
      `select=id,number,status,deadline_at,live_at&season_id=eq.${seasonId}` +
        `&number=in.(1,${TOP_PICKS_EPISODE})&order=number.asc`
    ),
    rest(
      'top_picks',
      `select=baker_id,rank,is_late,submitted_at&player_id=eq.${player.id}&order=rank.asc`
    ),
  ])

  const epOne = episodes.find((e) => e.number === 1) ?? null
  const epTwo = episodes.find((e) => e.number === TOP_PICKS_EPISODE) ?? null

  const chosen = picks.map((p) => p.baker_id)
  const base = {
    picks: chosen,
    isLate: picks[0]?.is_late ?? false,
    submittedAt: picks[0]?.submitted_at ?? null,
    deadlineAt: epTwo?.deadline_at ?? null,
    liveAt: epTwo?.live_at ?? null,
    count: TOP_PICKS_COUNT,
  }

  // Not open yet. Deliberately not an error state in the UI — before episode 1
  // is done there is simply nothing to say, and the panel hides the section.
  if (!epTwo) return { ...base, open: false, editable: false, reason: null, wouldBe: null }
  if (epOne && epOne.status !== 'complete') {
    return {
      ...base,
      open: false,
      editable: false,
      reason: 'Your top three opens once episode 1 is done.',
      wouldBe: null,
    }
  }

  // The entry carries gm_unlocked_at, and it is episode 2's entry that matters.
  // Whenever the window is genuinely open, episode 2 IS the current episode —
  // `pickCurrent` returns the lowest-numbered episode that is not complete, and
  // the window closes when episode 2 completes — so the entry buildState has
  // already fetched is the right one. Past that point the window is shut and
  // no lateness decision is left to make.
  const entry = currentEp?.id === epTwo.id ? currentEntry : null
  const lock = lockState(epTwo, entry, now)

  return {
    ...base,
    open: true,
    editable: !lock.locked,
    // lockState speaks about the episode, because that is what it is for. Said
    // to someone looking at a once-per-series commitment, "That episode is
    // over" is a non-sequitur — they are not looking at an episode. Same rule,
    // same clock, told in terms of the thing on screen.
    reason: lock.locked ? topThreeLockReason(epTwo, now) : null,
    wouldBe: lock.lateness ?? null,
  }
}

function topThreeLockReason(epTwo, now) {
  const live = epTwo.live_at ? new Date(epTwo.live_at) : null
  if (epTwo.status !== 'complete' && live && now >= live) {
    return `Episode ${epTwo.number} has started, so the top three is closed. Ask the GM to open it for you.`
  }
  return 'Your top three is locked in for the rest of the series.'
}

// ------------------------------------------------------------
// The bake guess — RULES §6
// ------------------------------------------------------------
/**
 * Everything the panel needs about the two bakes, resolved against episode 1.
 *
 * The window runs from the start of the season to episode 1's lock, which is
 * the ordinary lateness ladder and nothing new: on time, LATE after the
 * deadline, VERY LATE only if the GM opened that player's episode-1 door, and
 * shut otherwise. One door-opening covers a player's episode-1 picks and their
 * guesses together, exactly as one covers episode 2's picks and the top three.
 *
 * Whenever the window is open, episode 1 IS the current episode — `pickCurrent`
 * returns the lowest-numbered episode that is not complete — so the entry
 * buildState has already fetched is the right one, and nothing here needs a
 * second round trip for it.
 *
 * `guesses` is the player's OWN pair and comes back whatever the clock says:
 * this endpoint is authenticated by the code, and you may always see your own.
 * Everybody else's stays behind v_series_guesses_public until episode 1 airs.
 *
 * The HIT half is read from that public view rather than from v_guess_scores,
 * even for the player's own rows. A hit can only exist after episode 1's
 * deadline has passed — the same moment that view opens — so the gate costs
 * nothing here, and it means /play and the dashboard cannot end up telling two
 * different stories about the same guess.
 */
async function guessState(player, seasonId, currentEp, currentEntry, now) {
  const [episodes, mine, scored] = await Promise.all([
    rest(
      'episodes',
      `select=id,number,status,deadline_at,live_at&season_id=eq.${seasonId}` +
        `&number=eq.${GUESS_EPISODE}&limit=1`
    ),
    rest(
      'series_guesses',
      `select=slot,guess_text,guess_key,is_late,is_disallowed,submitted_at` +
        `&player_id=eq.${player.id}&order=slot.asc`
    ),
    rest(
      'v_series_guesses_public',
      `select=slot,hit_episode_number,points&player_id=eq.${player.id}`
    ),
  ])

  const epOne = episodes[0] ?? null
  const hits = new Map(scored.map((r) => [r.slot, r]))

  const slots = []
  for (let slot = 1; slot <= GUESS_SLOTS; slot += 1) {
    const row = mine.find((g) => g.slot === slot) ?? null
    const hit = hits.get(slot) ?? null
    slots.push({
      slot,
      text: row?.guess_text ?? '',
      // Only when the GM has actually unified it into something else. Sending
      // it always would put a second, near-identical word beside every guess on
      // the panel for no reason; sending it when it differs is the audit trail
      // that makes the edit fair (TECH_PLAN §14).
      unifiedTo: row && row.guess_key !== normaliseGuess(row.guess_text) ? row.guess_key : null,
      isLate: row?.is_late ?? false,
      isDisallowed: row?.is_disallowed ?? false,
      // Null until it comes up. A hit implies its episode has aired, so this is
      // also the flag for "there is anything to say about this guess yet".
      hitEpisode: hit?.hit_episode_number ?? null,
      points: hit?.hit_episode_number != null ? hit.points : null,
    })
  }

  const base = {
    slots,
    count: GUESS_SLOTS,
    maxLength: GUESS_MAX,
    deadlineAt: epOne?.deadline_at ?? null,
    submittedAt: mine[0]?.submitted_at ?? null,
  }

  // No episode 1 means no season worth speaking of. Nothing to say, and the
  // panel hides the section rather than explaining an empty database.
  if (!epOne) return { ...base, open: false, editable: false, reason: null, wouldBe: null }

  const entry = currentEp?.id === epOne.id ? currentEntry : null
  const lock = lockState(epOne, entry, now)

  return {
    ...base,
    open: true,
    editable: !lock.locked,
    // lockState speaks about episodes, because that is its job. "That episode
    // is over" said to somebody looking at a once-per-series commitment is a
    // non-sequitur — same rule, same clock, told in terms of what is on screen.
    reason: lock.locked ? guessLockReason(epOne, now) : null,
    wouldBe: lock.lateness ?? null,
  }
}

function guessLockReason(epOne, now) {
  const live = epOne.live_at ? new Date(epOne.live_at) : null
  if (epOne.status !== 'complete' && live && now >= live) {
    return 'Episode 1 has started, so the guesses are closed. Ask the GM to open it for you.'
  }
  return 'Your bake guesses are locked in for the rest of the series.'
}

// ------------------------------------------------------------
// State
// ------------------------------------------------------------

async function buildState(player) {
  const seasonId = player.leagues.season_id
  const episode = await currentEpisode(seasonId)

  const [allCategories, allBakers] = await Promise.all([
    rest('categories', 'select=*&order=sort_order.asc'),
    rest(
      'bakers',
      `select=id,name,photo_url,bio_line,status&season_id=eq.${seasonId}` +
        `&order=sort_order.asc,name.asc`
    ),
  ])

  // Two lists from one query, because they answer different questions.
  //
  // `bakers` is who you may pick — eliminated ones are gone from it, and the
  // filter stays here on the server so it cannot drift from savePicks.
  //
  // `bakerNames` is every baker who has ever been in the tent, so the panel can
  // put a name to a pick. That has to include the departed: the moment the
  // leaving result lands, api/gm.js marks that baker eliminated, and without
  // this the player who called it correctly would watch their best pick of the
  // week turn into a blank. Names are public anyway (v_baker_stats).
  const bakers = allBakers.filter((b) => PICKABLE.includes(b.status))
  const bakerNames = Object.fromEntries(allBakers.map((b) => [b.id, b.name]))

  let entry = null
  let picks = {}

  if (episode) {
    const rows = await rest(
      'entries',
      `select=*,predictions(category,baker_id)&player_id=eq.${player.id}` +
        `&episode_id=eq.${episode.id}&limit=1`
    )
    entry = rows[0] ?? null
    for (const p of entry?.predictions ?? []) picks[p.category] = p.baker_id
  }

  const standings = await rest(
    'v_standings',
    `select=total_points,position,episode_points,bonus_points&player_id=eq.${player.id}&limit=1`
  )

  const now = new Date()
  const lock = episode ? lockState(episode, entry, now) : { locked: true, reason: 'No episodes yet.' }

  const [topThree, guesses] = await Promise.all([
    topThreeState(player, seasonId, episode, entry, now),
    guessState(player, seasonId, episode, entry, now),
  ])

  return {
    player: {
      id: player.id,
      display_name: player.display_name,
      colour_hex: player.colour_hex,
      avatar_config: player.avatar_config,
      is_gm: player.is_gm,
    },
    league: player.leagues,
    episode,
    categories: episode ? categoriesFor(allCategories, episode) : [],
    bakers,
    bakerNames,
    picks,
    entry: entry && {
      lateness: entry.lateness,
      confirmed: entry.confirmed_at !== null,
      is_disallowed: entry.is_disallowed,
      gm_unlocked: entry.gm_unlocked_at !== null,
      submitted_at: entry.submitted_at,
    },
    editable: !lock.locked,
    lockReason: lock.reason ?? null,
    // What this save WOULD be flagged as, so the panel can warn before the
    // player commits rather than after.
    wouldBe: lock.lateness ?? null,
    topThree,
    guesses,
    standings: standings[0] ?? null,
    serverNow: now.toISOString(),
  }
}

// ------------------------------------------------------------
// Saving picks
// ------------------------------------------------------------

async function savePicks(res, player, body) {
  const { episodeId, picks, guesses } = body
  if (!isUuid(episodeId) || typeof picks !== 'object' || picks === null) {
    return res.status(400).json({ error: 'episodeId and picks are required.' })
  }

  const seasonId = player.leagues.season_id

  const episodes = await rest('episodes', `select=*&id=eq.${episodeId}&season_id=eq.${seasonId}&limit=1`)
  const episode = episodes[0]
  if (!episode) return res.status(404).json({ error: 'No such episode in your season.' })

  const existing = await rest(
    'entries',
    `select=*&player_id=eq.${player.id}&episode_id=eq.${episode.id}&limit=1`
  )
  const entry = existing[0] ?? null

  const now = new Date()
  const lock = lockState(episode, entry, now)
  if (lock.locked) return res.status(403).json({ error: lock.reason })

  if (entry?.is_disallowed) {
    return res.status(403).json({ error: 'The GM has disallowed this entry. Talk to them.' })
  }

  // ---- validate before writing anything ----

  const allCategories = await rest('categories', 'select=*')
  const allowed = new Set(categoriesFor(allCategories, episode).map((c) => c.key))

  const validBakers = await rest(
    'bakers',
    `select=id&season_id=eq.${seasonId}&status=in.(${PICKABLE.join(',')})`
  )
  const bakerIds = new Set(validBakers.map((b) => b.id))

  const toSet = []
  const toClear = []

  for (const [category, bakerId] of Object.entries(picks)) {
    if (!allowed.has(category)) {
      return res.status(400).json({
        error: `"${category}" isn't a category in ${episode.is_final ? 'the final' : 'this episode'}.`,
      })
    }
    if (bakerId === null) {
      toClear.push(category)
      continue
    }
    // Rejecting an eliminated baker here matters: the picker hides them, but a
    // stale tab from last week would still hold their id.
    if (!bakerIds.has(bakerId)) {
      return res.status(400).json({ error: 'That baker is not in the tent any more.' })
    }
    toSet.push({ category, baker_id: bakerId })
  }

  // The guesses ride along on this request rather than having a save of their
  // own, so they inherit `lock` above — episode 1's ladder, computed once. All
  // of this is validated BEFORE anything is written, so a rejected guess does
  // not leave the week's picks half-saved.
  let guessRows = null
  if (guesses !== undefined) {
    if (episode.number !== GUESS_EPISODE) {
      return res.status(403).json({
        error: 'The bake guesses closed when episode 1 started. They are in for the series.',
      })
    }
    const prepared = await prepareGuesses(player, guesses, lock, now)
    if (prepared.error) return res.status(prepared.status).json({ error: prepared.error })
    guessRows = prepared.rows
  }

  // ---- write ----

  const [saved] = await restInsert(
    'entries',
    {
      player_id: player.id,
      episode_id: episode.id,
      submitted_at: now.toISOString(),
      // Recomputed on every save on purpose: editing your picks after the
      // deadline IS a late submission, even if the first version was on time.
      lateness: lock.lateness,
    },
    { onConflict: 'player_id,episode_id' }
  )

  if (toSet.length) {
    await restInsert(
      'predictions',
      toSet.map((p) => ({ ...p, entry_id: saved.id, updated_at: now.toISOString() })),
      { onConflict: 'entry_id,category' }
    )
  }

  if (toClear.length) {
    const list = toClear.map((c) => `"${c}"`).join(',')
    await restDelete('predictions', `entry_id=eq.${saved.id}&category=in.(${list})`)
  }

  if (guessRows) {
    // Replace rather than upsert, for the reason saveTopPicks does: the table
    // is unique on (player_id, slot) AND on (player_id, guess_key), so moving a
    // guess from one slot to the other collides with a row this same edit is
    // about to move. Clearing first means the pair lands as one answer.
    await restDelete('series_guesses', `player_id=eq.${player.id}`)
    if (guessRows.length) await restInsert('series_guesses', guessRows)
  }

  return res.status(200).json(await buildState(player))
}

/**
 * Turn what the player typed into rows, or into a sentence saying why not.
 *
 * Two things are carried forward from whatever is already stored, and both
 * matter only in the narrow case where the GM has opened a door after the lock:
 *
 *   * `guess_key`, when the TEXT has not changed. Re-deriving it would wipe the
 *     GM's unification — the whole point of which is that it is deliberate and
 *     scoring-relevant — on a save that changed nothing.
 *   * `is_disallowed`, for a guess that survives the edit. Otherwise re-saving
 *     would quietly undo the GM's only switch for a VERY LATE guess.
 */
async function prepareGuesses(player, guesses, lock, now) {
  if (!Array.isArray(guesses) || guesses.length !== GUESS_SLOTS) {
    return { status: 400, error: `Send both guesses — ${GUESS_SLOTS} of them, blank ones included.` }
  }
  if (!guesses.every((g) => g === null || typeof g === 'string')) {
    return { status: 400, error: 'A guess is a bit of text.' }
  }

  const existing = await rest(
    'series_guesses',
    `select=slot,guess_text,guess_key,is_disallowed&player_id=eq.${player.id}`
  )

  const rows = []
  const seen = new Set()

  for (let i = 0; i < GUESS_SLOTS; i += 1) {
    const text = String(guesses[i] ?? '').replace(/\s+/g, ' ').trim()
    if (text === '') continue

    if (text.length > GUESS_MAX) {
      return { status: 400, error: `Keep a guess under ${GUESS_MAX} characters — it has to fit on a board.` }
    }

    const derived = normaliseGuess(text)
    // Something with no letters or digits in it, or a single stray character.
    // Not a rule about what a good guess is — that is RULES §6 and the GM's
    // call before the lock — just a floor under what counts as an answer.
    if (derived.length < 2) {
      return { status: 400, error: `"${text}" isn't a bake. Try a name, an ingredient or a technique.` }
    }

    const was = existing.find((g) => g.slot === i + 1) ?? null
    const unchanged = was && was.guess_text === text
    const key = unchanged ? was.guess_key : derived

    // Checked against the key that will actually be WRITTEN, not the one this
    // text derives to. If the GM has already unified one of the pair, those two
    // are different strings, and comparing the derived forms would let a
    // genuine collision through to the unique constraint as a 500.
    if (seen.has(key)) {
      return { status: 400, error: 'Two different guesses, please — that is the same one twice.' }
    }
    seen.add(key)

    rows.push({
      player_id: player.id,
      slot: i + 1,
      guess_text: text,
      guess_key: key,
      submitted_at: now.toISOString(),
      // Recomputed on every save, exactly like an entry's lateness: editing a
      // guess after the deadline IS a late submission, even if the first
      // version was in on time.
      is_late: lock.lateness !== 'on_time',
      is_disallowed: unchanged ? was.is_disallowed : false,
    })
  }

  return { rows }
}

// ------------------------------------------------------------
// Saving the top three — RULES §5
// ------------------------------------------------------------
// One request states the whole answer: three bakers, or nothing. That is the
// same shape as setCategory in api/gm.js and for the same reason — "you have
// exactly three, all different" cannot be violated by a half-finished edit if
// there is no way to add or remove one at a time.
//
// There is no un-picking and no swap. Once episode 2 locks, this refuses for
// the rest of the series (RULES §5), which is enforced by lockState and not by
// the absence of a button.

async function saveTopPicks(res, player, body) {
  const { bakerIds } = body

  if (!Array.isArray(bakerIds) || bakerIds.length !== TOP_PICKS_COUNT) {
    return res.status(400).json({ error: `Pick exactly ${TOP_PICKS_COUNT} bakers.` })
  }
  if (!bakerIds.every(isUuid)) {
    return res.status(400).json({ error: 'That is not a baker.' })
  }
  if (new Set(bakerIds).size !== bakerIds.length) {
    return res.status(400).json({ error: 'Three different bakers, please.' })
  }

  const seasonId = player.leagues.season_id
  const now = new Date()

  // The window and the lateness ladder, resolved exactly as the panel saw them
  // — same function, same episode, server clock. A stale tab that still has the
  // form open after the deadline gets the answer from here, not from its
  // buttons.
  const episode = await currentEpisode(seasonId)
  let entry = null
  if (episode) {
    const rows = await rest(
      'entries',
      `select=*&player_id=eq.${player.id}&episode_id=eq.${episode.id}&limit=1`
    )
    entry = rows[0] ?? null
  }

  const state = await topThreeState(player, seasonId, episode, entry, now)
  if (!state.open) {
    return res.status(403).json({ error: state.reason ?? 'The top three is not open.' })
  }
  if (!state.editable) {
    return res.status(403).json({ error: state.reason ?? 'Your top three is locked.' })
  }

  // Every id checked against the season's live cast before it goes anywhere
  // near a query string. The picker hides eliminated bakers, but a tab left
  // open across an episode still holds their ids — and the whole point of a
  // top three is that you are backing someone who is still in.
  const cast = await rest(
    'bakers',
    `select=id&season_id=eq.${seasonId}&status=in.(${PICKABLE.join(',')})`
  )
  const live = new Set(cast.map((b) => b.id))
  if (!bakerIds.every((id) => live.has(id))) {
    return res.status(400).json({ error: 'One of those bakers is not in the tent any more.' })
  }

  // Replace rather than upsert. `top_picks` is unique on (player_id, rank) AND
  // on (player_id, baker_id), so upserting row by row can collide with a row
  // this same edit is about to move — swapping two of your three would fail on
  // the second write. Clearing first means the three rows land as one answer.
  await restDelete('top_picks', `player_id=eq.${player.id}`)
  await restInsert(
    'top_picks',
    bakerIds.map((bakerId, i) => ({
      player_id: player.id,
      baker_id: bakerId,
      // Rank is a slot, not a preference: RULES §5 says the three are in no
      // particular order, and nothing scores them differently. It exists to
      // make "exactly three" a constraint the database can hold.
      rank: i + 1,
      submitted_at: now.toISOString(),
      is_late: state.wouldBe !== 'on_time',
    }))
  )

  return res.status(200).json(await buildState(player))
}

// ------------------------------------------------------------
// Confirm / un-confirm
// ------------------------------------------------------------
// Confirming is a statement about an entry, not a change to it, so it does NOT
// re-stamp lateness — otherwise hitting Confirm after the deadline would mark
// an entry late that was submitted in good time.

async function confirm(res, player, body) {
  const { episodeId, confirmed } = body
  if (!isUuid(episodeId)) return res.status(400).json({ error: 'episodeId is required.' })

  const episodes = await rest(
    'episodes',
    `select=*&id=eq.${episodeId}&season_id=eq.${player.leagues.season_id}&limit=1`
  )
  const episode = episodes[0]
  if (!episode) return res.status(404).json({ error: 'No such episode in your season.' })

  const existing = await rest(
    'entries',
    `select=*&player_id=eq.${player.id}&episode_id=eq.${episode.id}&limit=1`
  )
  const entry = existing[0]
  if (!entry) return res.status(400).json({ error: 'Make some picks first.' })

  const lock = lockState(episode, entry, new Date())
  if (lock.locked) return res.status(403).json({ error: lock.reason })

  await restPatch('entries', `id=eq.${entry.id}`, {
    confirmed_at: confirmed ? new Date().toISOString() : null,
  })

  return res.status(200).json(await buildState(player))
}
