import { useState, useEffect } from 'react'
import { Panel } from '../components/Panel.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { storedCode, rememberCode, forgetCode, playerPost } from '../lib/playerApi.js'
import { useCountdown } from '../lib/useCountdown.js'

/**
 * The player panel. Log in with a two-word code, make this week's picks,
 * Confirm.
 *
 * Nothing here is a rule. The countdown, the disabled buttons and the LATE
 * warning are conveniences — api/player.js re-derives every one of them from
 * the server clock, because a browser can lie about the time and a disabled
 * button can be re-enabled from devtools.
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
      .then((next) => { if (!cancelled) { setState(next); setError(null) } })
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
  const { player, league, episode, categories, bakers, entry, editable, lockReason, wouldBe, standings } = state

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
              {standings ? ` · ${standings.total_points} pts · ${ordinal(standings.position)}` : ''}
            </div>
          </div>
          <button className="link-btn" onClick={onOut}>Not you?</button>
        </div>
      </Panel>

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
      </Panel>
    </>
  )
}

function ordinal(n) {
  if (n == null) return ''
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
