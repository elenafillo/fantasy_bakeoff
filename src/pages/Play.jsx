import { useState, useEffect, useCallback } from 'react'
import { Panel } from '../components/Panel.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { Scorecard } from '../components/Scorecard.jsx'
import { storedCode, rememberCode, rememberWho, forgetCode, playerPost } from '../lib/playerApi.js'
import { useCountdown } from '../lib/useCountdown.js'
import { useRefreshOnFocus } from '../lib/useRefreshOnFocus.js'
import { fetchScoreboard, positionLabel } from '../lib/scores.js'

/**
 * The player panel. Log in with a two-word code, make this week's picks,
 * Confirm — and once results start landing, see how you did.
 *
 * Nothing here is a rule. The countdown, the disabled buttons and the LATE
 * warning are conveniences — api/player.js re-derives every one of them from
 * the server clock, because a browser can lie about the time and a disabled
 * button can be re-enabled from devtools. Every point on the scorecard likewise
 * arrives already worked out, from the views in supabase/views.sql.
 */
export default function Play() {
  const [code, setCode] = useState(() => storedCode())
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!code) return
    // Cancellation matters here: signing out and back in with a different code
    // can leave an earlier request in flight, and without this the slower of
    // the two wins and shows the wrong player's panel.
    let cancelled = false
    playerPost('state', code)
      .then((next) => {
        if (cancelled) return
        // Two public facts, cached so the dashboard can open on this player's
        // league with their row marked without an /api/player call of its own
        // (playerApi.js). Written on every state call, so it follows the GM
        // moving somebody between leagues.
        rememberWho({ playerId: next.player.id, leagueSlug: next.league.slug })
        setState(next)
        setError(null)
      })
      .catch((err) => { if (!cancelled) { setError(err.message); setState(null) } })
    return () => { cancelled = true }
  }, [code])

  function signOut() {
    forgetCode()
    setCode(null)
    setState(null)
    setError(null)
  }

  if (!code || (!state && error)) {
    return (
      <Login
        error={error}
        onIn={(c) => { setError(null); rememberCode(c); setCode(c) }}
      />
    )
  }

  if (!state) return <Panel><p className="muted">Opening your panel…</p></Panel>

  return <Entry state={state} code={code} setState={setState} onOut={signOut} />
}

// ------------------------------------------------------------
// Login
// ------------------------------------------------------------

function Login({ onIn, error }) {
  const [value, setValue] = useState('')

  return (
    <Panel head="Come in">
      <h1>What&rsquo;s your code?</h1>
      <p className="muted">
        Two words, from whoever runs your league. Capitals and hyphens don&rsquo;t matter.
      </p>
      <form
        className="login"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = value.trim()
          if (trimmed) onIn(trimmed)
        }}
      >
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="velvet crumb"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          aria-label="Your two-word code"
        />
        <button className="btn" type="submit">Let me in</button>
      </form>
      {error && <p className="notice bad" role="alert">{error}</p>}
    </Panel>
  )
}

// ------------------------------------------------------------
// The entry form
// ------------------------------------------------------------

function Entry({ state, code, setState, onOut }) {
  const {
    player, league, episode, categories, bakers, bakerNames,
    entry, editable, lockReason, wouldBe, standings, topThree,
  } = state

  // Picks are local until saved, so changing your mind is free and the server
  // hears about it once.
  const [picks, setPicks] = useState(state.picks)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [flash, setFlash] = useState(null)

  // Re-sync when the server sends a new state. Done during render rather than
  // in an effect: an effect would paint one frame of the old picks first, and
  // React's own guidance is to adjust state directly when it derives from a
  // changed prop. `state.picks` is a fresh object per response, so identity is
  // the right comparison.
  const [seenPicks, setSeenPicks] = useState(state.picks)
  if (seenPicks !== state.picks) {
    setSeenPicks(state.picks)
    setPicks(state.picks)
    setDirty(false)
  }

  const countdown = useCountdown(episode?.deadline_at)

  // ---- the scoreboard ----
  // Read straight from the granted views with the publishable key, never
  // through /api/player: eight phones refreshing all evening then costs zero
  // Vercel invocations (TECH_PLAN §6).
  const [board, setBoard] = useState(null)
  const [boardFailed, setBoardFailed] = useState(false)
  const [reloads, setReloads] = useState(0)

  const episodeId = episode?.id
  const episodeNumber = episode?.number
  const leagueId = league?.id

  useEffect(() => {
    if (!episodeId) return
    let cancelled = false
    fetchScoreboard({ episodeId, episodeNumber, leagueId, playerId: player.id })
      .then((next) => { if (!cancelled) { setBoard(next); setBoardFailed(false) } })
      .catch((err) => {
        if (cancelled) return
        // Not swallowed: supabase.js throws rather than returning an empty
        // array precisely so that a missing view or grant cannot read as "no
        // results yet". The panel keeps working; it just says so quietly.
        console.error('[scoreboard]', err)
        setBoardFailed(true)
      })
    return () => { cancelled = true }
  }, [episodeId, episodeNumber, leagueId, player.id, reloads])

  // Refresh when the tab comes back, not on a timer — see useRefreshOnFocus.js
  // and TECH_PLAN §8.
  const refresh = useCallback(() => {
    setReloads((n) => n + 1)
    // The picks, the lock and the bingo prompt come from /api/player, and that
    // half is skipped while there are unsaved changes: a fresh `state.picks`
    // re-syncs the form (see above) and would throw the player's edits away
    // without a word. No rule rests on the skip — savePicks re-derives the lock
    // from the server clock and answers 403 if the episode has since started.
    if (dirty || busy) return
    playerPost('state', code).then(setState).catch(() => {
      // A background refresh that fails leaves what is on screen alone.
    })
  }, [dirty, busy, code, setState])

  useRefreshOnFocus(refresh)

  // The standings row from the scoreboard and the one /api/player sent are the
  // same row; preferring the fresher one keeps the total in the header and the
  // position on the scorecard from being two snapshots of different moments.
  const mine = board?.mine ?? standings
  const hasResults = (board?.results?.length ?? 0) > 0

  if (!episode) {
    return (
      <Panel head="Your panel">
        <h1>No episodes yet</h1>
        <p className="muted">The season hasn&rsquo;t been set up. Nudge the GM.</p>
      </Panel>
    )
  }

  async function send(action, extra) {
    setBusy(true)
    setError(null)
    setFlash(null)
    try {
      setState(await playerPost(action, code, { episodeId: episode.id, ...extra }))
      if (action === 'savePicks') setFlash('Saved')
      if (action === 'saveTopPicks') setFlash('Your top three is in')
      // A save can change the score, not just the picks: a VERY LATE entry the
      // GM opened the door for is submitted with results already in. Cheap to
      // re-read — it is a Supabase query, not a Vercel invocation.
      setReloads((n) => n + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const picked = categories.filter((c) => picks[c.key]).length

  return (
    <>
      <Panel>
        <div className="who">
          <Avatar name={player.display_name} colour={player.colour_hex} />
          <div>
            <strong>{player.display_name}</strong>
            <div className="small muted">
              {league.name}
              {mine ? ` · ${mine.total_points} pts · ${positionLabel(mine.position, board?.joint)}` : ''}
            </div>
          </div>
          <button className="link-btn" onClick={onOut}>Not you?</button>
        </div>
      </Panel>

      {/* Once results start landing this is what you opened the page for, so it
          goes above the form. Before that there is nothing in it but blanks, and
          it stays away entirely.

          It judges `state.picks` — what you actually submitted — and not the
          local `picks`, which is whatever you are in the middle of typing. */}
      {hasResults && (
        <Scorecard
          categories={categories}
          picks={state.picks}
          bakerNames={bakerNames}
          results={board.results}
          week={board.week}
          position={mine?.position ?? null}
          joint={board.joint}
          movement={board.movement}
        />
      )}

      <Panel head={`Episode ${episode.number}${episode.theme ? ` · ${episode.theme}` : ''}`}>
        <div className="deadline">
          <span className={`pill ${countdown.passed ? 'bad' : 'ok'}`}>
            <span className="dot" />
            {countdown.label}
          </span>
          {entry?.lateness && entry.lateness !== 'on_time' && (
            <span className="pill bad">
              <span className="dot" />
              {entry.lateness === 'late' ? 'Late' : 'Very late'}
            </span>
          )}
          {entry?.confirmed && <span className="pill ok"><span className="dot" />Confirmed</span>}
          {entry?.is_disallowed && (
            <span className="pill bad"><span className="dot" />Disallowed by the GM</span>
          )}
        </div>

        {episode.bingo_prompt ? (
          <p className="bingo">
            <span className="eyebrow">This week&rsquo;s bingo</span>
            {episode.bingo_prompt}
          </p>
        ) : (
          <p className="small muted">The GM hasn&rsquo;t written this week&rsquo;s bingo yet.</p>
        )}

        {!editable && <p className="notice bad">{lockReason}</p>}

        {editable && wouldBe !== 'on_time' && (
          <p className="notice">
            {wouldBe === 'late'
              ? 'The deadline has passed — anything you save now is marked LATE.'
              : 'The episode has started. The GM opened this for you, so your entry is marked VERY LATE.'}
          </p>
        )}

        {bakers.length === 0 && (
          <p className="notice">The cast hasn&rsquo;t been added yet, so there&rsquo;s nobody to pick.</p>
        )}

        <div className="pickers">
          {categories.map((c) => (
            <label key={c.key} className="picker">
              <span className="picker-label">
                {c.label} <span className="muted">+{c.points}</span>
              </span>
              <select
                className="input"
                value={picks[c.key] ?? ''}
                disabled={!editable || busy || bakers.length === 0}
                onChange={(e) => {
                  setPicks({ ...picks, [c.key]: e.target.value || null })
                  setDirty(true)
                }}
              >
                <option value="">— nobody yet —</option>
                {bakers.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <p className="small muted">
          {picked} of {categories.length} chosen. An incomplete entry still scores
          for whatever you did fill in.
        </p>

        {error && <p className="notice bad" role="alert">{error}</p>}
        {flash && <p className="notice ok" role="status">{flash}</p>}

        {editable && (
          <div className="actions">
            <button className="btn" disabled={busy || !dirty} onClick={() => send('savePicks', { picks })}>
              {dirty ? 'Save picks' : 'Saved'}
            </button>

            {entry && !dirty && (
              <button
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => send('confirm', { confirmed: !entry.confirmed })}
              >
                {entry.confirmed ? 'Un-confirm' : 'Confirm entry'}
              </button>
            )}
          </div>
        )}

        {dirty && <p className="small muted">Unsaved changes.</p>}

        {boardFailed && (
          <p className="small muted">
            Couldn&rsquo;t load this week&rsquo;s scores just now. Your picks are safe.
          </p>
        )}
      </Panel>

      {/* After the weekly picks, because that is the order of importance every
          week except one: this is a once-per-series item and the panel above is
          the reason people opened the page. */}
      <TopThree
        topThree={topThree}
        bakers={bakers}
        bakerNames={bakerNames}
        busy={busy}
        onSave={(bakerIds) => send('saveTopPicks', { bakerIds })}
      />
    </>
  )
}

// ------------------------------------------------------------
// The top three — RULES §5
// ------------------------------------------------------------
/**
 * Once per series: pick three bakers to reach the final, after you have seen
 * everyone bake once. No order, no swaps, ever.
 *
 * The window and the lateness ladder are episode 2's, computed server-side in
 * api/player.js by the same `lockState` the weekly picks use — so everything
 * here is presentation. `topThree.editable` decides whether this is a form or a
 * receipt; the server decides again on save.
 *
 * Chosen bakers are a SET, not three ranked slots. Three selects would have
 * implied an order that RULES §5 explicitly does not have, and would have made
 * "you cannot pick the same person twice" a rule to explain rather than one the
 * interface makes unavailable.
 */
function TopThree({ topThree, bakers, bakerNames, busy, onSave }) {
  const [chosen, setChosen] = useState(topThree.picks)

  // Re-sync on a fresh server state, the same way the weekly picks do.
  const [seen, setSeen] = useState(topThree.picks)
  if (seen !== topThree.picks) {
    setSeen(topThree.picks)
    setChosen(topThree.picks)
  }

  // Nothing to say yet — usually because episode 1 is still to come.
  if (!topThree.open) {
    if (!topThree.reason) return null
    return (
      <Panel head="Your top three">
        <p className="muted">{topThree.reason}</p>
        <p className="small muted">
          Three bakers to reach the final. {topThree.count === 3 ? '+3' : ''} each if they
          do, +6 more if one of them wins it.
        </p>
      </Panel>
    )
  }

  const full = chosen.length === topThree.count
  const same =
    chosen.length === topThree.picks.length &&
    chosen.every((id) => topThree.picks.includes(id))

  function toggle(id) {
    setChosen((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        // Silently ignoring the fourth tap would look broken, so the buttons
        // are disabled at three instead and the count below says why.
        : prev.length >= topThree.count ? prev : [...prev, id]
    )
  }

  return (
    <Panel head="Your top three">
      <h2 className="th-head">Three bakers, for the whole series</h2>
      <p className="small muted">
        +3 for each one who reaches the final, and +6 more if one of them wins it.
        In no particular order — and <strong>no swaps later</strong>, even if one
        goes home.
      </p>

      {!topThree.editable ? (
        <>
          <p className="notice">{topThree.reason ?? 'Locked in.'}</p>
          {topThree.picks.length > 0 ? (
            <ul className="th-locked">
              {topThree.picks.map((id) => (
                <li key={id}>{bakerNames[id] ?? 'Unknown baker'}</li>
              ))}
            </ul>
          ) : (
            <p className="small muted">
              You didn&rsquo;t pick a top three, so there are no series bonuses to come.
            </p>
          )}
        </>
      ) : (
        <>
          {topThree.wouldBe !== 'on_time' && (
            <p className="notice">
              {topThree.wouldBe === 'late'
                ? 'The deadline has passed — this will be marked LATE.'
                : 'The episode has started. The GM opened this for you, so it will be marked VERY LATE.'}
            </p>
          )}

          <ul className="th-grid">
            {bakers.map((b) => {
              const on = chosen.includes(b.id)
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    className={`th-chip ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    disabled={busy || (full && !on)}
                    onClick={() => toggle(b.id)}
                  >
                    {b.name}
                  </button>
                </li>
              )
            })}
          </ul>

          <p className="small muted">
            {chosen.length} of {topThree.count} chosen.
            {' '}
            {/* The deadline is episode 2's, and the window is only ever open
                while episode 2 is the current one — so this always IS the same
                clock as the panel above, and a second countdown ticking beside
                the first would only invite the question of which one counts. */}
            Locks with this week&rsquo;s picks.
          </p>

          <div className="actions">
            <button className="btn" disabled={busy || !full || same} onClick={() => onSave(chosen)}>
              {same && full ? 'Saved' : 'Save my three'}
            </button>
          </div>
        </>
      )}
    </Panel>
  )
}
