// ============================================================
// POST /api/gm — everything the GM does
// ============================================================
// Actions: state · setCategory · setEpisode · toggleDisallow · unlockEntry ·
//          upsertLeague · upsertPlayer · generateCode · upsertBaker ·
//          setGuess · setGuessHit
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
import { prettyCode, IDENTITY_COLOURS } from './_wordlists.js'
import { issueCode } from './_codes.js'
import { normaliseGuess, GUESS_MAX } from './_guesses.js'

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
      case 'toggleDisallow':
        return await toggleDisallow(res, body)
      case 'unlockEntry':
        return await unlockEntry(res, body)
      case 'upsertLeague':
        return await upsertLeague(res, body)
      case 'upsertPlayer':
        return await upsertPlayer(res, body)
      case 'generateCode':
        return await generateCode(res, body)
      case 'upsertBaker':
        return await upsertBaker(res, body)
      case 'setGuess':
        return await setGuess(res, body)
      case 'setGuessHit':
        return await setGuessHit(res, body)
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
    // THE REVEAL, NOT THE DEADLINE — the mirror of v_public_predictions' WHERE
    // clause, and it has to move whenever that does. The GM is a player, so a
    // panel that showed everyone's picks at 18:00 while the league waited until
    // 20:00 would hand the one person entering results a two-hour look at cards
    // nobody else can see. RULES §8 promises they see them no earlier than
    // anybody else, and this line is the whole of that promise on this side of
    // the wire.
    picksPublic = Boolean(episode.live_at) && new Date(episode.live_at) <= now
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

  const guesses = await buildGuesses(season, episodes, players, now)

  return {
    season,
    leagues,
    categories,
    bakers,
    episodes,
    episode,
    guesses,
    // What the GM can score this week. The final swaps Star Baker and the
    // elimination for the outright winner, and the Live tab must not offer a
    // category that nobody was allowed to predict.
    episodeCategories: episode ? categoriesFor(categories, episode) : [],
    results,
    entries: entries.map((en) => shapeEntry(en, picksPublic)),
    picksPublic,
    // The palette the Players tab offers. Sent from here rather than imported
    // into src/, because api/_wordlists.js also holds the code vocabulary and
    // nothing in the browser has any business with that.
    colours: IDENTITY_COLOURS,
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

/**
 * The Guesses tab's data — RULES §6.
 *
 * SEASON-WIDE, not per episode, and that is what makes it one of the tabs about
 * the season rather than about a league: `guess_hits` is keyed on the season, so
 * one tick covers every league playing the series, exactly like a result.
 *
 * THE GM IS A PLAYER TOO, so this withholds the guesses themselves until
 * episode 1's deadline has passed — the moment the GM's own pair is locked
 * along with everybody else's. Before that it sends a count and nothing more,
 * the same rule shapeEntry applies to picks and for the same reason.
 *
 * TWO MOMENTS, AND THIS FUNCTION NOW USES BOTH. `locksAt` is episode 1's
 * DEADLINE: the instant everybody's pair stops being editable, which is what
 * the tab counts down to. `visible` is episode 1's AIR TIME, the instant the
 * public board opens (v_series_guesses_public). They were the same value until
 * RULES §2.5 split them, and conflating them again in either direction breaks
 * something real — read from the deadline and the GM sees the list two hours
 * before the league; read from the air time and the tab tells people their
 * guesses are still editable when they are not.
 *
 * The gap between the two is the GM's window for unifying the wordings before
 * anybody else reads them, which is how RULES §6 describes the job and which
 * the deadline-gated version had quietly taken away.
 *
 * `points` and `holders` come from v_guess_scores — the service role reads it
 * even though rls.sql grants it to nobody. The grouping below is display; the
 * arithmetic stays in SQL, so this panel cannot disagree with the dashboard
 * about what a guess is worth.
 */
async function buildGuesses(season, episodes, players, now) {
  const episodeOne = episodes.find((e) => e.number === 1) ?? null
  const visible =
    Boolean(episodeOne?.live_at) && new Date(episodeOne.live_at) <= now

  const ids = players.map((p) => p.id)
  if (ids.length === 0) {
    return { visible, submitted: 0, players: 0, keys: [], orphans: [], locksAt: episodeOne?.deadline_at ?? null }
  }

  const rows = await rest(
    'series_guesses',
    `select=id,player_id,slot,guess_text,guess_key,is_late,is_disallowed` +
      `&player_id=in.(${ids.join(',')})&order=guess_key.asc,slot.asc`
  )

  const submitted = new Set(rows.map((r) => r.player_id)).size

  if (!visible) {
    // A count, and not one word of what anybody wrote. The scores and hits are
    // not fetched at all — this runs on every GM action, including each result
    // typed on the night, and there is nothing they could be used for yet.
    return {
      visible: false,
      submitted,
      players: ids.length,
      keys: [],
      orphans: [],
      locksAt: episodeOne?.deadline_at ?? null,
    }
  }

  const [scores, hits] = await Promise.all([
    rest('v_guess_scores', `select=player_id,guess_key,holders,episode_id,points&season_id=eq.${season.id}`),
    rest('guess_hits', `select=guess_key,episode_id&season_id=eq.${season.id}`),
  ])

  const byId = new Map(players.map((p) => [p.id, p]))
  const scoreOf = new Map(scores.map((s) => [`${s.player_id} ${s.guess_key}`, s]))
  const episodeOf = new Map(episodes.map((e) => [e.id, e]))
  const hitOf = new Map(hits.map((h) => [h.guess_key, h]))

  const grouped = new Map()
  for (const row of rows) {
    if (!grouped.has(row.guess_key)) grouped.set(row.guess_key, [])
    const player = byId.get(row.player_id)
    const score = scoreOf.get(`${row.player_id} ${row.guess_key}`) ?? null
    grouped.get(row.guess_key).push({
      id: row.id,
      player_id: row.player_id,
      display_name: player?.display_name ?? 'Unknown',
      colour_hex: player?.colour_hex ?? null,
      league_id: player?.league_id ?? null,
      slot: row.slot,
      // What they typed, never edited. It sits beside the key on the tab so the
      // unification is visible rather than something that happened to them.
      guess_text: row.guess_text,
      is_late: row.is_late,
      is_disallowed: row.is_disallowed,
      // Null for a disallowed guess: v_guess_scores drops it, which is the
      // point of the switch.
      points: score?.points ?? null,
      holders: score?.holders ?? null,
    })
  }

  const keys = [...grouped.entries()]
    .map(([key, holders]) => {
      const hit = hitOf.get(key) ?? null
      return {
        key,
        holders,
        hit_episode_id: hit?.episode_id ?? null,
        hit_episode_number: hit ? (episodeOf.get(hit.episode_id)?.number ?? null) : null,
      }
    })
    // Unresolved first, then alphabetically: the weekly job is scanning the
    // ones still in play, and a guess that has already paid is done with.
    .sort((a, b) =>
      (a.hit_episode_id ? 1 : 0) - (b.hit_episode_id ? 1 : 0) || a.key.localeCompare(b.key)
    )

  // A tick whose key nobody holds any more — the GM unified a guess after
  // ticking it, and the hit now pays nobody. Harmless (v_guess_scores left-joins
  // hits to guesses, so an orphan simply never matches) but invisible unless the
  // panel says so, which is how it would go unnoticed for a series.
  const held = new Set(rows.map((r) => r.guess_key))
  const orphans = hits
    .filter((h) => !held.has(h.guess_key))
    .map((h) => ({
      key: h.guess_key,
      episode_id: h.episode_id,
      episode_number: episodeOf.get(h.episode_id)?.number ?? null,
    }))

  return { visible: true, submitted, players: ids.length, keys, orphans, locksAt: episodeOne?.deadline_at ?? null }
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

async function loadPlayer(season, playerId) {
  if (!isUuid(playerId)) throw new HttpError(400, 'Which player?')
  const rows = await rest(
    'players',
    `select=id,league_id,display_name,code_norm,leagues!inner(season_id)` +
      `&id=eq.${playerId}&leagues.season_id=eq.${season.id}&limit=1`
  )
  if (!rows[0]) throw new HttpError(404, 'No such player in this season.')
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

    // Read the category BEFORE writing it. Who leaves the category matters as
    // much as who arrives — that difference is what lets a mistaken
    // elimination be taken back below.
    const existing = await rest('episode_results', `select=id,baker_id,voided&${scope}`)
    const wereWinners = existing.filter((r) => !r.voided).map((r) => r.baker_id)
    let nowWinners = []

    if (value === 'undecided') {
      await restDelete('episode_results', scope)
    } else if (value === 'nobody') {
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

      const already = new Set(wereWinners)
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
      nowWinners = bakerIds
    }

    if (category === 'leaving') {
      await syncEliminations(season, episode, wereWinners, nowWinners)
    }

    return res.status(200).json(await buildState({ episodeId: episode.id }))
  } catch (err) {
    return fail(res, err)
  }
}

/**
 * Recording who left an episode also marks them out of the tent.
 *
 * The two are the same fact, and entering one without the other leaves an
 * eliminated baker sitting in everybody's picker the following week. So the
 * leaving result owns it — but only for the bakers it names, and only for its
 * own episode:
 *
 *   named as leaving in episode N  →  eliminated, eliminated_episode = N
 *   taken back out of episode N    →  active again, but ONLY if they are
 *                                     currently eliminated AT N
 *
 * That second filter is the whole safety of doing this automatically. Changing
 * a mis-entered elimination undoes itself, while a baker marked out by hand in
 * another week — a withdrawal, an illness, someone who left for reasons that
 * were never an elimination — is never touched by a result that did not name
 * them. Bakers left the tent for their own reasons long before this code ran.
 *
 * The final has no `leaving` category at all (seed.sql: applies_to 'regular'),
 * so this cannot fire against a finalist.
 */
async function syncEliminations(season, episode, before, after) {
  const arrived = after.filter((id) => !before.includes(id))
  const gone = before.filter((id) => !after.includes(id))

  if (arrived.length) {
    await restPatch(
      'bakers',
      `season_id=eq.${season.id}&id=in.(${arrived.join(',')})`,
      { status: 'eliminated', eliminated_episode: episode.number }
    )
  }

  if (gone.length) {
    await restPatch(
      'bakers',
      `season_id=eq.${season.id}&id=in.(${gone.join(',')})` +
        `&status=eq.eliminated&eliminated_episode=eq.${episode.number}`,
      { status: 'active', eliminated_episode: null }
    )
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
  // When the episode goes on air, and therefore THE HARD LOCK (RULES §2.5).
  // Derived from air_date at 20:00 by schema.sql's trigger, and editable here
  // for a week that airs at an odd hour — exactly like deadline_at above.
  //
  // This replaced a `goLive` action that stamped it with the server clock when
  // the GM pressed a button. A rule that depends on somebody remembering to
  // press a button mid-episode is not a rule; a derived timestamp cannot be
  // forgotten. Clearing it means nobody is locked out, which is the same
  // direction lockState already fails in for an episode with no schedule.
  live_at: 'instant',
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
      // 'live' is missing on purpose, and now for a better reason than before:
      // whether an episode is on air is `live_at <= now()`, computed wherever
      // it is needed, so there is no stored status to set or to go stale. Only
      // 'complete' is load-bearing — it is what moves everyone on to next week.
      throw new HttpError(400, 'Status is upcoming, locked or complete.')
    }
    return s
  }

  throw new HttpError(400, `Cannot set ${field}.`)
}

// ------------------------------------------------------------
// The hard lock, and why there is no longer a button for it
// ------------------------------------------------------------
// `goLive` used to live here. It stamped live_at with the server clock and set
// status to 'live', and it was the most consequential button in the panel —
// live_at is the boundary between LATE and locked out (RULES §2.5).
//
// It was removed because a rule that depends on somebody pressing a button
// mid-episode is not a rule. Forget it and the panel never locks, so a player
// could submit at 21:15 having watched the technical, flagged only LATE — and
// nothing anywhere would say so. The same forgotten tap left the dashboard
// polling every 30s through the one hour it exists for.
//
// live_at is now derived from air_date at 20:00 by schema.sql's trigger, the
// same way deadline_at is derived at 18:00, and it is editable through
// setEpisode for a week that airs at an odd hour. Two moments, one date,
// neither of them forgettable. "Take it back" became "move the time".
//
// Whether an episode is on air is `live_at <= now()`, computed where it is
// needed (v_episodes_public.is_live for the browser, serverNow for the panel),
// so no status has to be set and none can go stale.

// ------------------------------------------------------------
// Bakers — the cast
// ------------------------------------------------------------
// THE INVARIANT THE SCHEMA DOES NOT HOLD: a baker whose status is 'eliminated'
// has an eliminated_episode, and a baker with any other status has none.
// v_baker_stats.weeks_survived reads that column, and a NULL there means "still
// in", so an elimination without a number quietly counts as a full run of the
// series. It is enforced here, in the one endpoint that writes the table, the
// same way the Nobody/winners invariant is (see setCategory).
//
// There is no delete, for the same reason there is no delete on players: it
// cascades to every prediction naming them. Renaming is what you actually want
// when the real cast is announced — the ids stay put, so test picks survive.

const BAKER_STATUSES = ['active', 'eliminated', 'finalist', 'winner']

async function upsertBaker(res, body) {
  try {
    const season = await activeSeason()
    // Only for the default elimination episode, so a missing one is not fatal.
    const episode = isUuid(body.episodeId)
      ? (await rest('episodes', `select=number&id=eq.${body.episodeId}&season_id=eq.${season.id}&limit=1`))[0]
      : null

    const cast = await rest('bakers', `select=*&season_id=eq.${season.id}`)
    const name = typeof body.name === 'string' ? body.name.trim() : ''

    let current = null
    if (body.bakerId !== undefined) {
      if (!isUuid(body.bakerId)) throw new HttpError(400, 'Which baker?')
      current = cast.find((b) => b.id === body.bakerId) ?? null
      if (!current) throw new HttpError(404, 'No such baker in this season.')
    }

    if ('name' in body || !current) {
      if (!name) throw new HttpError(400, 'A baker needs a name.')
      const clash = cast.find(
        (b) => b.id !== current?.id && b.name.toLowerCase() === name.toLowerCase()
      )
      if (clash) throw new HttpError(400, `There is already a ${clash.name} in this season.`)
    }

    const patch = {}
    if ('name' in body || !current) patch.name = name
    if ('bio_line' in body) patch.bio_line = blankToNull(body.bio_line)
    if ('photo_url' in body) patch.photo_url = blankToNull(body.photo_url)
    if ('sort_order' in body) patch.sort_order = wholeNumber(body.sort_order, 'sort order')

    // status and eliminated_episode always travel together, whichever of them
    // the request names — that is what makes the invariant hold after every
    // write rather than after most of them.
    if ('status' in body || 'eliminated_episode' in body || !current) {
      const status = 'status' in body ? String(body.status) : (current?.status ?? 'active')
      if (!BAKER_STATUSES.includes(status)) {
        throw new HttpError(400, `Status is one of ${BAKER_STATUSES.join(', ')}.`)
      }
      patch.status = status
      patch.eliminated_episode =
        status === 'eliminated'
          ? leftInEpisode(season, body.eliminated_episode, current, episode)
          : null
    }

    if (current) {
      if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change.')
      await restPatch('bakers', `id=eq.${current.id}`, patch)
    } else {
      await restInsert('bakers', {
        season_id: season.id,
        sort_order: patch.sort_order ?? cast.reduce((m, b) => Math.max(m, b.sort_order), 0) + 1,
        ...patch,
      })
    }

    return res.status(200).json(await buildState(body))
  } catch (err) {
    return fail(res, err)
  }
}

/**
 * Which episode a baker left in. Falls back to the number already stored, then
 * to whichever episode the panel is showing — so marking someone out on the
 * night is one tap, and a status edit that says nothing about the episode does
 * not silently move it.
 */
function leftInEpisode(season, raw, current, episode) {
  const blank = raw === null || raw === undefined || raw === ''
  const n = blank ? (current?.eliminated_episode ?? episode?.number) : Number(raw)

  if (!Number.isInteger(n) || n < 1 || n > season.episode_count) {
    throw new HttpError(
      400,
      `Which episode did they leave in? A number from 1 to ${season.episode_count}.`
    )
  }
  return n
}

function blankToNull(raw) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim()
  return s === '' ? null : s
}

function wholeNumber(raw, what) {
  const n = Number(raw)
  if (!Number.isInteger(n)) throw new HttpError(400, `The ${what} has to be a whole number.`)
  return n
}

// ------------------------------------------------------------
// The bake guess — unifying, and the weekly tick
// ------------------------------------------------------------
// Two verbs, and the split is the same one episode_results makes: setGuess says
// what a guess IS, setGuessHit says what HAPPENED. Neither awards a point —
// v_guess_scores applies the 5/2/0 tiers — so despite this game being described
// as "manual", there is no manual-points column anywhere in it.
//
// `guess_text` is not editable here, or anywhere. What the player typed is the
// record; the GM's canonical form is a second column beside it. That is what
// keeps unifying auditable, and unifying needs to be auditable because it is
// SCORING-RELEVANT: turning "madeleines" into "madeleine" can move somebody
// from sole (+5) to shared (+2).

async function setGuess(res, body) {
  try {
    const season = await activeSeason()
    if (!isUuid(body.guessId)) throw new HttpError(400, 'Which guess?')

    const rows = await rest(
      'series_guesses',
      `select=id,player_id,guess_key&id=eq.${body.guessId}&limit=1`
    )
    const guess = rows[0]
    if (!guess) throw new HttpError(404, 'No such guess.')

    // Scoped to the season in a second step rather than through a two-level
    // embedded filter. loadPlayer already does exactly this check and is used
    // by every other action here, so the scoping cannot quietly differ — and a
    // filter that silently failed to apply would be a scoping hole rather than
    // an error. With the demo seasons in the database this is not theoretical.
    await loadPlayer(season, guess.player_id)

    const patch = {}

    if ('guess_key' in body) {
      const key = normaliseGuess(body.guess_key)
      if (key.length < 2) {
        throw new HttpError(400, 'A guess needs at least a couple of characters in it.')
      }
      if (key.length > GUESS_MAX) {
        throw new HttpError(400, `Keep it under ${GUESS_MAX} characters.`)
      }
      // The player holds two guesses and they must stay different. The unique
      // constraint would refuse this anyway; catching it here means the GM is
      // told what happened rather than shown a Postgres error.
      const theirs = await rest(
        'series_guesses',
        `select=id,guess_key&player_id=eq.${guess.player_id}`
      )
      const clash = theirs.find((g) => g.id !== guess.id && g.guess_key === key)
      if (clash) {
        throw new HttpError(
          400,
          `That would give them "${key}" twice. Unify the other one instead, or leave them apart.`
        )
      }
      patch.guess_key = key
    }

    if ('is_disallowed' in body) patch.is_disallowed = body.is_disallowed === true

    if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change.')

    await restPatch('series_guesses', `id=eq.${guess.id}`, patch)
    return res.status(200).json(await buildState(body))
  } catch (err) {
    return fail(res, err)
  }
}

/**
 * Tick a guess as having come up, or take the tick back.
 *
 * Keyed on the CANONICAL form, so one tick covers every player holding it —
 * which is what makes the weekly job shrink as the series runs: a hit resolves
 * a guess and it drops off the list.
 *
 * Ticking a key that already has a hit MOVES it to the named episode rather
 * than failing. A guess still pays once — the unique constraint on
 * (season_id, guess_key) sees to that, and the upsert merges on it — so the
 * only thing this permits is correcting the week, which is a mis-tap the GM
 * will otherwise have to fix in SQL on episode night.
 */
async function setGuessHit(res, body) {
  try {
    const season = await activeSeason()
    const episode = await loadEpisode(season, body.episodeId)

    const key = normaliseGuess(body.guessKey)
    if (key.length < 2) throw new HttpError(400, 'Which guess?')

    if (body.hit === false) {
      await restDelete(
        'guess_hits',
        `season_id=eq.${season.id}&guess_key=eq.${encodeURIComponent(key)}`
      )
    } else {
      await restInsert(
        'guess_hits',
        { season_id: season.id, guess_key: key, episode_id: episode.id },
        { onConflict: 'season_id,guess_key' }
      )
    }

    return res.status(200).json(await buildState({ episodeId: episode.id }))
  } catch (err) {
    return fail(res, err)
  }
}

// ------------------------------------------------------------
// Leagues — the parallel tables
// ------------------------------------------------------------
// A league is a roster and a table, NOT a copy of the game. Bakers, episodes,
// deadlines and every result hang off the season and are shared by all of them
// (TECH_PLAN §2), so a second league costs nothing on the night: each result is
// still typed once and every league's dashboard moves at the same moment.
//
// There is no delete, for the same reason there is none on players or bakers,
// only more so — it cascades through players to every entry, prediction and top
// three in one statement. Archiving is what you actually want: v_leagues_public
// already carries `where is_active`, so an archived league drops off the
// dashboard while all of its data stays exactly where it was.
//
// ⚠️ ARCHIVING IS A DISPLAY CHANGE, NOT A LOCK. api/player.js finds a player by
// their code alone and takes the league off the join, with no is_active check —
// so an archived league's players can still log in at /play and submit picks.
// Archive last year's league; do not archive one to shut somebody out.

async function upsertLeague(res, body) {
  try {
    const season = await activeSeason()
    // EVERY league, not just this season's: leagues.slug is a plain unique
    // constraint rather than a per-season one, because a /league/<slug> URL
    // carries no season with it.
    const all = await rest('leagues', 'select=id,season_id,name,slug,is_default,is_active')
    const mine = all.filter((l) => l.season_id === season.id)

    const name = typeof body.name === 'string' ? body.name.trim() : ''

    let current = null
    if (body.leagueId !== undefined) {
      if (!isUuid(body.leagueId)) throw new HttpError(400, 'Which league?')
      current = mine.find((l) => l.id === body.leagueId) ?? null
      if (!current) throw new HttpError(404, 'No such league in this season.')
    }

    const patch = {}

    if ('name' in body || !current) {
      if (!name) throw new HttpError(400, 'A league needs a name.')
      const clash = mine.find(
        (l) => l.id !== current?.id && l.name.toLowerCase() === name.toLowerCase()
      )
      if (clash) throw new HttpError(400, `There is already a league called ${clash.name}.`)
      patch.name = name
    }

    if ('slug' in body || !current) {
      const asked =
        'slug' in body && String(body.slug ?? '').trim() ? body.slug : (patch.name ?? current?.name)
      const slug = slugify(asked)
      if (!slug) throw new HttpError(400, 'A link needs some letters or numbers in it.')
      const clash = all.find((l) => l.id !== current?.id && l.slug === slug)
      if (clash) throw new HttpError(400, `/league/${slug} is already ${clash.name}.`)
      patch.slug = slug
    }

    if ('is_active' in body) {
      const active = body.is_active === true
      if (!active && current?.is_default) {
        throw new HttpError(
          400,
          'That is the league an anonymous visitor lands on. Make another league the default first.'
        )
      }
      patch.is_active = active
    }

    // The default can be MOVED but never switched off. It is what someone
    // opening "/" with no code sees, and a season with none makes that landing
    // page arbitrary — src/lib/dashboard.js falls through to whichever league it
    // happened to fetch first. So only `true` does anything here, and the first
    // league in a season takes it automatically rather than leaving that gap.
    const makeDefault = body.is_default === true || (!current && mine.length === 0)

    if (makeDefault) {
      const willBeActive = 'is_active' in patch ? patch.is_active : (current?.is_active ?? true)
      if (!willBeActive) throw new HttpError(400, 'An archived league cannot be the default.')

      // Clear first, then set. leagues_one_default_per_season permits exactly
      // one, so set-then-clear is rejected outright by the index. This order
      // leaves a moment with no default rather than a moment with two, which is
      // the harmless direction to fail in.
      await restPatch('leagues', `season_id=eq.${season.id}&is_default=is.true`, {
        is_default: false,
      })
      patch.is_default = true
    }

    if (current) {
      if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change.')
      await restPatch('leagues', `id=eq.${current.id}`, patch)
    } else {
      await restInsert('leagues', { season_id: season.id, ...patch })
    }

    return res.status(200).json(await buildState(body))
  } catch (err) {
    return fail(res, err)
  }
}

/**
 * A slug has to survive being a URL and being read down a phone. It is
 * NORMALISED rather than validated, so "The Proving Drawer" quietly becomes
 * "the-proving-drawer" instead of being handed back as an error.
 *
 * The result must match the /league/<slug> pattern in src/App.jsx — a league
 * whose slug the router rejects exists with no way to link to it, which is a
 * thing you would only discover after sending the link round.
 */
function slugify(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
}

// ------------------------------------------------------------
// Players — the roster and the codes
// ------------------------------------------------------------
// A code IS the credential, so it is issued here and never in the browser.
// Creating a player issues one in the same breath: a player without a code
// cannot log in, so there is no useful moment between the two.
//
// There is deliberately no delete. Removing a player cascades to their entries
// and predictions with no undo, and a name typed wrong can simply be retyped.
// If someone really has to go, it is one line of SQL and a moment's thought.

async function upsertPlayer(res, body) {
  try {
    const season = await activeSeason()
    const name = typeof body.display_name === 'string' ? body.display_name.trim() : ''

    if (body.playerId !== undefined) {
      const player = await loadPlayer(season, body.playerId)

      const patch = {}
      if ('display_name' in body) {
        if (!name) throw new HttpError(400, 'A player needs a name.')
        patch.display_name = name
      }
      if ('colour_hex' in body) {
        patch.colour_hex = await freeColour(body.colour_hex, player.league_id, player.id)
      }
      if ('is_gm' in body) patch.is_gm = body.is_gm === true

      if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nothing to change.')
      await restPatch('players', `id=eq.${player.id}`, patch)
      return res.status(200).json(await buildState(body))
    }

    // ---- a new player ----

    if (!isUuid(body.leagueId)) throw new HttpError(400, 'Which league?')
    const leagues = await rest(
      'leagues',
      `select=id&id=eq.${body.leagueId}&season_id=eq.${season.id}&limit=1`
    )
    if (!leagues[0]) throw new HttpError(404, 'No such league in this season.')
    if (!name) throw new HttpError(400, 'A player needs a name.')

    const colour = await freeColour(body.colour_hex, body.leagueId, null)
    const { norm } = await freshCode(body.leagueId)

    await restInsert('players', {
      league_id: body.leagueId,
      display_name: name,
      code_norm: norm,
      colour_hex: colour,
      is_gm: body.is_gm === true,
    })

    return res.status(200).json(await buildState(body))
  } catch (err) {
    return fail(res, err)
  }
}

/**
 * Reissue somebody's code. The old one stops working the instant this lands —
 * there is no grace period, because two live codes for one player is exactly
 * the confusion this is meant to end.
 *
 * Their current code stays in the roster passed to issueCode, so the new one
 * shares no word with the old: being moved from "velvet crumb" to "velvet
 * scone" would be a worse experience than the wordlist being one pair smaller.
 */
async function generateCode(res, body) {
  try {
    const season = await activeSeason()
    const player = await loadPlayer(season, body.playerId)
    const { norm } = await freshCode(player.league_id)
    await restPatch('players', `id=eq.${player.id}`, { code_norm: norm })
    return res.status(200).json(await buildState(body))
  } catch (err) {
    return fail(res, err)
  }
}

/**
 * Two different lists, for two different rules: no WORD may repeat inside a
 * league (they get read aloud in one room), and no CODE may repeat anywhere at
 * all (code_norm is globally unique, and a code alone has to identify both the
 * player and their league).
 */
async function freshCode(leagueId) {
  const [roster, everyone] = await Promise.all([
    rest('players', `select=code_norm&league_id=eq.${leagueId}`),
    rest('players', 'select=code_norm'),
  ])
  return issueCode({
    roster: roster.map((p) => p.code_norm),
    taken: everyone.map((p) => p.code_norm),
  })
}

/**
 * A colour is unique within a league (a partial unique index says so) because
 * the leaderboard and the chart are otherwise ambiguous. Checking here rather
 * than catching the constraint's error means the GM gets told whose it is.
 */
async function freeColour(raw, leagueId, exceptPlayerId) {
  const hex = String(raw ?? '').trim().toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(hex)) throw new HttpError(400, 'A colour looks like #2a78d6.')

  // encodeURIComponent is not optional here: an unescaped # starts the URL's
  // fragment, and the filter would silently become "colour_hex=eq.".
  const rows = await rest(
    'players',
    `select=id,display_name&league_id=eq.${leagueId}&colour_hex=eq.${encodeURIComponent(hex)}`
  )
  const clash = rows.find((p) => p.id !== exceptPlayerId)
  if (clash) throw new HttpError(400, `${clash.display_name} already has that colour.`)
  return hex
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
