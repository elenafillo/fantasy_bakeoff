// ============================================================
// POST /api/gm — everything the GM does
// ============================================================
// Actions: state · setCategory · setEpisode · goLive · toggleDisallow ·
//          unlockEntry
//
// The password is compared against process.env.GM_PASSWORD on EVERY request.
// There is no session and no token, deliberately: a session is a second thing
// that can be stolen, and the panel is used from whatever phone is to hand.
// `is_gm` on the players table is a display flag and is not consulted here —
// the password is the whole of the authorisation.
//
// Every write in here runs under the service role, which bypasses RLS. That is
// the point of the endpoint and also the reason it validates hard: ids are
// checked as UUIDs before they reach a query string, categories against the
// categories table, bakers against the season.

import crypto from 'node:crypto'
import { rest, restInsert, restPatch, restDelete, jsonBody, isUuid } from './_supabase.js'
import { pickCurrent, categoriesFor } from './_episodes.js'
import { prettyCode } from './_wordlists.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })

  const body = jsonBody(req)
  if (!body) return res.status(400).json({ error: 'Malformed JSON body.' })

  if (!gmPassword()) {
    // Refusing to run without a password is the only safe failure. An empty
    // env var must never mean "no password required" — this endpoint can
    // rewrite every result in the game.
    return res.status(500).json({
      error: 'GM_PASSWORD is not set on this deployment, so the panel is closed.',
    })
  }

  if (!passwordMatches(body.password)) {
    await new Promise((r) => setTimeout(r, 400))
    return res.status(401).json({ error: "That's not the password." })
  }

  try {
    switch (body.action) {
      case 'state':
        return res.status(200).json(await buildState(body))
      case 'setCategory':
        return await setCategory(res, body)
      case 'setEpisode':
        return await setEpisode(res, body)
      case 'goLive':
        return await goLive(res, body)
      case 'toggleDisallow':
        return await toggleDisallow(res, body)
      case 'unlockEntry':
        return await unlockEntry(res, body)
      default:
        return res.status(400).json({ error: `Unknown action "${body.action}".` })
    }
  } catch (err) {
    console.error('[api/gm]', err)
    return res.status(500).json({ error: err.message })
  }
}

// ------------------------------------------------------------
// The door
// ------------------------------------------------------------

/**
 * Both sides are trimmed. A password pasted into a hosting dashboard picks up a
 * trailing newline about as often as not, and the resulting failure is
 * invisible from both ends: the env var looks right in the UI, the typed
 * password looks right in the box, and the only symptom is a panel that will
 * not open. Nobody's password deliberately ends in a space.
 */
function gmPassword() {
  return (process.env.GM_PASSWORD ?? '').trim()
}

/**
 * Compared over SHA-256 digests rather than the strings themselves: equal
 * lengths, so timingSafeEqual cannot throw and the comparison does not leak the
 * password's length. Nobody is timing-attacking a bake-off league, but this is
 * three lines and the alternative is a habit worth not having.
 */
function passwordMatches(given) {
  const typed = typeof given === 'string' ? given.trim() : ''
  if (typed.length === 0) return false
  const digest = (s) => crypto.createHash('sha256').update(s, 'utf8').digest()
  return crypto.timingSafeEqual(digest(typed), digest(gmPassword()))
}

// ------------------------------------------------------------
// State — one round trip, everything the panel draws
// ------------------------------------------------------------

async function activeSeason() {
  const rows = await rest('seasons', 'select=*&is_active=eq.true&order=year.desc&limit=1')
  if (!rows[0]) throw new Error('No active season. Run supabase/seed.sql.')
  return rows[0]
}

async function buildState({ episodeId }) {
  const season = await activeSeason()

  const [categories, bakers, episodes, leagues, players] = await Promise.all([
    rest('categories', 'select=*&order=sort_order.asc'),
    // Every status, unlike the player panel: an eliminated baker is still the
    // answer to "who left in episode 3?", so results must be enterable and
    // editable after they have gone.
    rest('bakers', `select=*&season_id=eq.${season.id}&order=sort_order.asc,name.asc`),
    rest('episodes', `select=*&season_id=eq.${season.id}&order=number.asc`),
    rest('leagues', `select=*&season_id=eq.${season.id}&order=name.asc`),
    rest(
      'players',
      `select=id,league_id,display_name,code_norm,colour_hex,is_gm,leagues!inner(season_id)` +
        `&leagues.season_id=eq.${season.id}&order=display_name.asc`
    ),
  ])

  const episode =
    (isUuid(episodeId) && episodes.find((e) => e.id === episodeId)) || pickCurrent(episodes)

  const now = new Date()
  let results = []
  let entries = []
  let picksPublic = false

  if (episode) {
    picksPublic = Boolean(episode.deadline_at) && new Date(episode.deadline_at) <= now
    ;[results, entries] = await Promise.all([
      rest(
        'episode_results',
        `select=id,category,baker_id,voided,entered_at&episode_id=eq.${episode.id}` +
          `&order=entered_at.asc`
      ),
      rest(
        'entries',
        `select=id,player_id,submitted_at,confirmed_at,lateness,is_disallowed,gm_unlocked_at,` +
          `players(display_name,colour_hex),predictions(category,baker_id)` +
          `&episode_id=eq.${episode.id}`
      ),
    ])
  }

  return {
    season,
    leagues,
    categories,
    bakers,
    episodes,
    episode,
    // What the GM can score this week. The final swaps Star Baker and the
    // elimination for the outright winner, and the Live tab must not offer a
    // category that nobody was allowed to predict.
    episodeCategories: episode ? categoriesFor(categories, episode) : [],
    results,
    entries: entries.map((en) => shapeEntry(en, picksPublic)),
    picksPublic,
    players: players.map((p) => ({
      id: p.id,
      league_id: p.league_id,
      display_name: p.display_name,
      colour_hex: p.colour_hex,
      is_gm: p.is_gm,
      // The stored form is one word; this is the readable one. Both log in, so
      // the panel can hand the GM the version that survives being read aloud —
      // and code_norm itself never leaves the server.
      code: prettyCode(p.code_norm),
    })),
    serverNow: now.toISOString(),
  }
}

/**
 * The GM is also a player. Handing the panel everyone's picks before the
 * deadline would put the one screen that shows them in the hands of someone
 * with an entry of their own — so before the deadline the Entries tab gets
 * counts, and after it, the picks. Same rule as v_public_predictions, applied
 * for the same reason at the other end of the wire.
 */
function shapeEntry(en, picksPublic) {
  const predictions = en.predictions ?? []
  return {
    id: en.id,
    player_id: en.player_id,
    display_name: en.players?.display_name ?? 'Unknown',
    colour_hex: en.players?.colour_hex ?? null,
    submitted_at: en.submitted_at,
    confirmed: en.confirmed_at !== null,
    lateness: en.lateness,
    is_disallowed: en.is_disallowed,
    gm_unlocked: en.gm_unlocked_at !== null,
    picks_made: predictions.length,
    picks: picksPublic
      ? Object.fromEntries(predictions.map((p) => [p.category, p.baker_id]))
      : null,
  }
}

// ------------------------------------------------------------
// Shared validation
// ------------------------------------------------------------

async function loadEpisode(season, episodeId) {
  if (!isUuid(episodeId)) throw new HttpError(400, 'Pick an episode first.')
  const rows = await rest(
    'episodes',
    `select=*&id=eq.${episodeId}&season_id=eq.${season.id}&limit=1`
  )
  if (!rows[0]) throw new HttpError(404, 'No such episode in this season.')
  return rows[0]
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Turns a thrown HttpError into its response; anything else keeps bubbling. */
function fail(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message })
  throw err
}

// ------------------------------------------------------------
// Results — the Live tab's only write
// ------------------------------------------------------------
// ONE action sets a category's entire state, rather than four that each add or
// remove a row. The invariant is that a category is either Nobody or has
// winners and never both (schema.sql spells out why: with both present,
// scoring silently ignores the Nobody row). Separate add/clear/void actions
// would each have to remember to undo the other kind — this way the illegal
// state is not reachable, because every write states the whole answer.
//
//   value: 'undecided'        no rows at all — the GM hasn't got there yet
//   value: 'nobody'           one voided row — nothing happened, nobody scores
//   value: [bakerId, ...]     one row per winner; several is normal
//
// Order within a write is insert-then-delete on purpose. If a request dies in
// the middle, the leftover state is "winners and a void row coexist", which
// v_prediction_scores already resolves in favour of the winners. Deleting first
// would leave a category looking undecided instead — the one state the GM
// cannot tell apart from work they haven't done yet.

async function setCategory(res, body) {
  try {
    const season = await activeSeason()
    const episode = await loadEpisode(season, body.episodeId)

    const categories = await rest('categories', 'select=*')
    const allowed = new Set(categoriesFor(categories, episode).map((c) => c.key))
    const category = String(body.category ?? '')
    if (!allowed.has(category)) {
      throw new HttpError(400, `"${category}" isn't scored in this episode.`)
    }

    const value = body.value
    const isList = Array.isArray(value)
    if (!isList && value !== 'undecided' && value !== 'nobody') {
      throw new HttpError(400, 'value must be "undecided", "nobody", or a list of bakers.')
    }
    if (isList && value.length === 0) {
      // Never guess. An empty list could mean either "clear this" or "nobody
      // won it", and those are the two states this whole design keeps apart.
      throw new HttpError(400, 'Send "undecided" to clear a category, or "nobody" to void it.')
    }

    const cat = encodeURIComponent(category)
    const scope = `episode_id=eq.${episode.id}&category=eq.${cat}`

    if (value === 'undecided') {
      await restDelete('episode_results', scope)
    } else if (value === 'nobody') {
      const existing = await rest('episode_results', `select=id,voided&${scope}`)
      if (!existing.some((r) => r.voided)) {
        await restInsert('episode_results', {
          episode_id: episode.id,
          category,
          baker_id: null,
          voided: true,
        })
      }
      await restDelete('episode_results', `${scope}&voided=is.false`)
    } else {
      const bakerIds = [...new Set(value)]
      if (!bakerIds.every(isUuid)) throw new HttpError(400, 'That is not a baker.')

      const inSeason = await rest(
        'bakers',
        `select=id&season_id=eq.${season.id}&id=in.(${bakerIds.join(',')})`
      )
      if (inSeason.length !== bakerIds.length) {
        throw new HttpError(400, 'One of those bakers is not in this season.')
      }

      const existing = await rest('episode_results', `select=id,baker_id,voided&${scope}`)
      const already = new Set(existing.filter((r) => !r.voided).map((r) => r.baker_id))
      const missing = bakerIds.filter((id) => !already.has(id))

      if (missing.length) {
        await restInsert(
          'episode_results',
          missing.map((baker_id) => ({
            episode_id: episode.id,
            category,
            baker_id,
            voided: false,
          }))
        )
      }
      // Two deletes, not one: `baker_id=not.in.(…)` is NULL for the void row,
      // and NULL is not true, so a single filter would leave the void behind.
      await restDelete('episode_results', `${scope}&voided=is.true`)
      await restDelete(
        'episode_results',
        `${scope}&voided=is.false&baker_id=not.in.(${bakerIds.join(',')})`
      )
    }

    return res.status(200).json(await buildState({ episodeId: episode.id }))
  } catch (err) {
    return fail(res, err)
  }
}

// ------------------------------------------------------------
// Episodes
// ------------------------------------------------------------

const EPISODE_FIELDS = {
  theme: 'text',
  bingo_prompt: 'text',
  air_date: 'date',
  deadline_at: 'instant',
  status: 'status',
}

async function setEpisode(res, body) {
  try {
    const season = await activeSeason()
    const episode = await loadEpisode(season, body.episodeId)

    const patch = {}
    for (const [field, kind] of Object.entries(EPISODE_FIELDS)) {
      // Only fields the request actually names. This matters more than it
      // looks: the deadline trigger in schema.sql derives deadline_at from
      // air_date only when the same statement did not also set deadline_at, so
      // a panel that helpfully sent every field on every save would silently
      // stop deadlines following the air date.
      if (!(field in body)) continue
      patch[field] = coerce(field, kind, body[field])
    }

    if (Object.keys(patch).length === 0) {
      throw new HttpError(400, 'Nothing to change.')
    }

    await restPatch('episodes', `id=eq.${episode.id}`, patch)
    return res.status(200).json(await buildState({ episodeId: episode.id }))
  } catch (err) {
    return fail(res, err)
  }
}

function coerce(field, kind, raw) {
  const blank = raw === null || raw === undefined || raw === ''

  if (kind === 'text') return blank ? null : String(raw).trim()

  if (kind === 'date') {
    if (blank) return null
    const s = String(raw)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
      throw new HttpError(400, 'The air date needs to look like 2026-09-29.')
    }
    return s
  }

  if (kind === 'instant') {
    // Clearing the deadline is allowed and is not an edge case: an episode
    // with no deadline is one nobody can be late for, and its predictions stay
    // private (views.sql). It is the state every episode starts in.
    if (blank) return null
    const t = Date.parse(String(raw))
    if (Number.isNaN(t)) throw new HttpError(400, 'That deadline is not a time I can read.')
    return new Date(t).toISOString()
  }

  if (kind === 'status') {
    const s = String(raw)
    if (!['upcoming', 'locked', 'complete'].includes(s)) {
      // 'live' is missing on purpose: it is the one status with a side effect
      // (live_at, the hard lock), so it is only reachable through goLive.
      throw new HttpError(400, 'Status is upcoming, locked or complete — use Go live for live.')
    }
    return s
  }

  throw new HttpError(400, `Cannot set ${field}.`)
}

// ------------------------------------------------------------
// Go live — the hard lock
// ------------------------------------------------------------
// live_at is the boundary between LATE and locked-out, so this is the most
// consequential button in the panel. Two rules:
//
//   * Going live twice does not re-stamp live_at. A second tap would move the
//     boundary and could turn an entry that was accepted into one that should
//     never have been.
//   * It can be taken back, because the alternative to an undo is everyone
//     locked out an hour early with no way back but SQL. Lateness already
//     stamped on an entry stays: that is a record of when they submitted, not
//     a status to be recalculated.

async function goLive(res, body) {
  try {
    const season = await activeSeason()
    const episode = await loadEpisode(season, body.episodeId)
    const live = body.live !== false

    const patch = live
      ? { status: 'live', live_at: episode.live_at ?? new Date().toISOString() }
      : { status: 'locked', live_at: null }

    await restPatch('episodes', `id=eq.${episode.id}`, patch)
    return res.status(200).json(await buildState({ episodeId: episode.id }))
  } catch (err) {
    return fail(res, err)
  }
}

// ------------------------------------------------------------
// Entries — the Disallow switch
// ------------------------------------------------------------
// Excludes an entry from scoring AND from every stat, as if it were never made
// (RULES §2.5). Every scoring view filters on is_disallowed, so this one column
// takes effect everywhere at once.

async function toggleDisallow(res, body) {
  try {
    const season = await activeSeason()
    const episode = await loadEpisode(season, body.episodeId)
    if (!isUuid(body.entryId)) throw new HttpError(400, 'Which entry?')

    // Scoped to the episode, which is already scoped to the season — so an id
    // from another week cannot be flipped by naming this one.
    const rows = await rest(
      'entries',
      `select=id&id=eq.${body.entryId}&episode_id=eq.${episode.id}&limit=1`
    )
    if (!rows[0]) throw new HttpError(404, 'No such entry in this episode.')

    await restPatch('entries', `id=eq.${rows[0].id}`, {
      is_disallowed: body.disallowed === true,
    })

    return res.status(200).json(await buildState({ episodeId: episode.id }))
  } catch (err) {
    return fail(res, err)
  }
}

// ------------------------------------------------------------
// Entries — opening the door
// ------------------------------------------------------------
// gm_unlocked_at is the ONLY thing that permits a write after live_at
// (api/player.js, lockState). It is per player, per week, and it cannot be done
// quietly: anything submitted through it is stamped VERY LATE.
//
// This is keyed on the PLAYER, not on an entry, because the person who needs
// the door opened is usually the person who has not submitted at all — and
// lockState reads gm_unlocked_at off an entry row, so one has to exist. Opening
// a door for someone with no entry therefore creates an empty one.
//
// That placeholder takes the default lateness ('on_time') rather than being
// stamped very late up front. Nothing has been submitted yet, and savePicks
// recomputes lateness from the server clock on every save — so stamping it here
// would only be a lie in the case where the GM opens a door in advance and the
// player then submits before the episode airs.
//
// Closing a door that was never walked through deletes the placeholder, so an
// unused unlock does not leave a phantom 0-point entry in the standings.

async function unlockEntry(res, body) {
  try {
    const season = await activeSeason()
    const episode = await loadEpisode(season, body.episodeId)
    if (!isUuid(body.playerId)) throw new HttpError(400, 'Which player?')

    const players = await rest(
      'players',
      `select=id,leagues!inner(season_id)&id=eq.${body.playerId}` +
        `&leagues.season_id=eq.${season.id}&limit=1`
    )
    if (!players[0]) throw new HttpError(404, 'No such player in this season.')

    const rows = await rest(
      'entries',
      `select=id,predictions(category)&player_id=eq.${body.playerId}` +
        `&episode_id=eq.${episode.id}&limit=1`
    )
    const entry = rows[0] ?? null
    const open = body.open !== false

    if (open && entry) {
      await restPatch('entries', `id=eq.${entry.id}`, {
        gm_unlocked_at: new Date().toISOString(),
      })
    } else if (open) {
      await restInsert('entries', {
        player_id: body.playerId,
        episode_id: episode.id,
        gm_unlocked_at: new Date().toISOString(),
      })
    } else if (entry && (entry.predictions ?? []).length === 0) {
      await restDelete('entries', `id=eq.${entry.id}`)
    } else if (entry) {
      await restPatch('entries', `id=eq.${entry.id}`, { gm_unlocked_at: null })
    }

    return res.status(200).json(await buildState({ episodeId: episode.id }))
  } catch (err) {
    return fail(res, err)
  }
}
