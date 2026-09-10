import { useState, useEffect } from 'react'
import { Panel } from '../components/Panel.jsx'
import { storedPassword, rememberPassword, forgetPassword, gmPost } from '../lib/gmApi.js'
import { LiveTab } from './gm/LiveTab.jsx'
import { EpisodesTab } from './gm/EpisodesTab.jsx'
import { EntriesTab } from './gm/EntriesTab.jsx'
import { PlayersTab } from './gm/PlayersTab.jsx'
import { BakersTab } from './gm/BakersTab.jsx'
import { GuessesTab } from './gm/GuessesTab.jsx'
import { LeaguesTab } from './gm/LeaguesTab.jsx'
import { ALL, byLeagueOrder } from './gm/leagueScope.js'
import { isOnAir } from './gm/time.js'

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
  ['players', 'Players', PlayersTab],
  ['bakers', 'Bakers', BakersTab],
  // A season tab, like Live and Bakers: one tick covers every league. It is
  // read once to tidy the wordings and then briefly each week, which puts it
  // behind the tabs used at speed and in front of the one used once ever.
  ['guesses', 'Guesses', GuessesTab],
  // Last: a league is set up once and then left alone, so it sits past the tabs
  // that get used every week rather than in front of them on a phone.
  ['leagues', 'Leagues', LeaguesTab],
]

// The two tabs that are about a league rather than about the season, and so the
// only two the league picker appears over. gm/leagueScope.js explains why the
// other four must not get one — Guesses included, despite being full of people.
const LEAGUE_SCOPED = new Set(['entries', 'players'])

function Console({ state, password, setState, onLock }) {
  const [tab, setTab] = useState('live')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [leagueId, setLeagueId] = useState(ALL)

  const { episode, episodes, leagues } = state

  // A league that has gone away — archived and deleted from another device,
  // say — must not leave the panel filtered to nobody with no way back.
  const scope = leagues.some((l) => l.id === leagueId) ? leagueId : ALL

  // Shown on both league-scoped tabs whatever the count, including the ordinary
  // one-league case. Appearing only once a second league exists would mean the
  // control nobody has seen turns up on the evening it first matters — and it
  // is also the answer to "which of these tabs is about a league?", which is
  // worth being able to read off the screen rather than having to know.
  const showLeagues = LEAGUE_SCOPED.has(tab) && leagues.length > 0

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
            {/* Counts everything in the season, archived leagues and their
                players included — the same basis for all three numbers. */}
            <div className="small muted">
              {state.players.length} player{state.players.length === 1 ? '' : 's'} ·{' '}
              {state.leagues.length} league{state.leagues.length === 1 ? '' : 's'} ·{' '}
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
                {isOnAir(e, state.serverNow)
                  ? ' · ON AIR'
                  : e.status === 'complete' ? ' · done' : ''}
              </option>
            ))}
          </select>
        </label>

        {showLeagues && (
          <label className="field">
            <span className="picker-label">League</span>
            <select
              className="input"
              value={scope}
              disabled={busy}
              onChange={(e) => setLeagueId(e.target.value)}
            >
              <option value={ALL}>All leagues</option>
              {[...leagues].sort(byLeagueOrder).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}{l.is_active ? '' : ' · archived'}
                </option>
              ))}
            </select>
            <span className="small muted">
              Who is playing, and nothing else. The episodes, the cast and every
              result are the same for all of them.
            </span>
          </label>
        )}

        {error && <p className="notice bad" role="alert">{error}</p>}
      </Panel>

      {!episode ? (
        <Panel><p className="muted">No episodes in this season yet.</p></Panel>
      ) : (
        <Active state={state} send={send} busy={busy} leagueId={scope} />
      )}

    </>
  )
}
