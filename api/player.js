// ============================================================
// POST /api/player — everything a player does
// ============================================================
// Actions: login · state · savePicks · confirm
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

// The statuses a player can still be picked in. 'finalist' and 'winner' stay
// pickable, which is what makes the final's card work. Written once because
// buildState and savePicks must agree: the picker would otherwise offer a baker
// the save then refuses, or hide one it would have accepted.
const PICKABLE = ['active', 'finalist', 'winner']

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
    standings: standings[0] ?? null,
    serverNow: now.toISOString(),
  }
}

// ------------------------------------------------------------
// Saving picks
// ------------------------------------------------------------

async function savePicks(res, player, body) {
  const { episodeId, picks } = body
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
