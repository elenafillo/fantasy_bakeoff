import { useState, useEffect } from 'react'
import { Panel } from '../components/Panel.jsx'
import { storedPassword, rememberPassword, forgetPassword, gmPost } from '../lib/gmApi.js'
import { LiveTab } from './gm/LiveTab.jsx'
import { EpisodesTab } from './gm/EpisodesTab.jsx'
import { EntriesTab } from './gm/EntriesTab.jsx'

/**
 * The GM control room.
 *
 * The password is never checked here — it is posted to /api/gm and compared
 * against process.env.GM_PASSWORD on every single request. Nothing gated by
 * this screen is enforced in the browser; this component only decides what to
 * draw, and the server decides what may happen.
 *
 * Every write returns the whole state, so the panel never has to guess what
 * the database now holds — which matters most on the Live tab, where the GM is
 * making a change every thirty seconds and cannot be checking whether the
 * screen still matches reality.
 *
 * This file is the shell: the door, the episode picker, the tab bar. Each tab
 * is its own file under gm/, because Live is read at speed in a dark room and
 * should not be somewhere in the middle of a thousand lines.
 */
export default function Gm() {
  const [password, setPassword] = useState(() => storedPassword())
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!password) return
    // Cancellation matters: a slow first request must not overwrite the state
    // from a later one.
    let cancelled = false
    gmPost('state', password)
      .then((next) => { if (!cancelled) { setState(next); setError(null) } })
      .catch((err) => {
        if (cancelled) return
        setError(err.message)
        setState(null)
        // Only a 401 means the password is wrong. Anything else — a hiccup, a
        // cold function, no signal — keeps it, because throwing away a working
        // password mid-episode means retyping it one-handed.
        if (err.status === 401) {
          forgetPassword()
          setPassword(null)
        }
      })
    return () => { cancelled = true }
  }, [password])

  function lock() {
    forgetPassword()
    setPassword(null)
    setState(null)
    setError(null)
  }

  if (!password) return <Gate error={error} onIn={(p) => { rememberPassword(p); setPassword(p) }} />

  if (!state) {
    return (
      <Panel head="Behind the counter">
        {error ? (
          <>
            <p className="notice bad" role="alert">{error}</p>
            <div className="actions">
              <button className="btn" onClick={() => setPassword(password)}>Try again</button>
              <button className="btn btn-quiet" onClick={lock}>Lock the panel</button>
            </div>
          </>
        ) : (
          <p className="muted">Opening the panel…</p>
        )}
      </Panel>
    )
  }

  return <Console state={state} password={password} setState={setState} onLock={lock} />
}

// ------------------------------------------------------------
// The door
// ------------------------------------------------------------

function Gate({ onIn, error }) {
  const [value, setValue] = useState('')

  return (
    <Panel head="Behind the counter">
      <h1>GM panel</h1>
      <p className="muted">The password, please.</p>
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
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="current-password"
          aria-label="GM password"
        />
        <button className="btn" type="submit">Open up</button>
      </form>
      {error && <p className="notice bad" role="alert">{error}</p>}
      <p className="small muted">
        Held for this browser tab only. Close the tab and the panel closes with it.
      </p>
    </Panel>
  )
}

// ------------------------------------------------------------
// The console
// ------------------------------------------------------------

const TABS = [
  ['live', 'Live', LiveTab],
  ['episodes', 'Episodes', EpisodesTab],
  ['entries', 'Entries', EntriesTab],
]

function Console({ state, password, setState, onLock }) {
  const [tab, setTab] = useState('live')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const { episode, episodes } = state

  async function send(action, extra = {}) {
    setBusy(true)
    setError(null)
    try {
      setState(await gmPost(action, password, { episodeId: episode?.id, ...extra }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const Active = TABS.find(([key]) => key === tab)?.[2] ?? LiveTab

  return (
    <>
      <Panel>
        <div className="who">
          <div>
            <strong>{state.season.name}</strong>
            <div className="small muted">
              {state.players.length} player{state.players.length === 1 ? '' : 's'} ·{' '}
              {state.bakers.length} bakers
            </div>
          </div>
          <button className="link-btn" onClick={onLock}>Lock</button>
        </div>

        <div className="tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              className="tab"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="picker-label">Episode</span>
          <select
            className="input"
            value={episode?.id ?? ''}
            disabled={busy}
            onChange={(e) => send('state', { episodeId: e.target.value })}
          >
            {episodes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.number}. {e.theme || (e.is_final ? 'The final' : 'No theme yet')}
                {e.status === 'live' ? ' · LIVE' : e.status === 'complete' ? ' · done' : ''}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="notice bad" role="alert">{error}</p>}
      </Panel>

      {!episode ? (
        <Panel><p className="muted">No episodes in this season yet.</p></Panel>
      ) : (
        <Active state={state} send={send} busy={busy} />
      )}

      <Panel>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Players and Bakers are next — until then, the roster and the cast are
          set up in SQL.
        </p>
      </Panel>
    </>
  )
}
