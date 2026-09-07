import { useState, useEffect } from 'react'
import { Panel } from '../components/Panel.jsx'
import { storedPassword, rememberPassword, forgetPassword, gmPost } from '../lib/gmApi.js'

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
  ['live', 'Live'],
  ['episodes', 'Episodes'],
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
      ) : tab === 'live' ? (
        <LiveTab state={state} send={send} busy={busy} />
      ) : (
        <EpisodesTab state={state} send={send} busy={busy} />
      )}

      <Panel>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Entries, Players and Bakers are next — until then, players and the cast
          are set up in SQL.
        </p>
      </Panel>
    </>
  )
}

// ------------------------------------------------------------
// Live — the episode-night screen
// ------------------------------------------------------------

function LiveTab({ state, send, busy }) {
  const { episode, episodeCategories, results, bakers, entries } = state

  return (
    <>
      <Panel head={`Episode ${episode.number}${episode.theme ? ` · ${episode.theme}` : ''}`}>
        <div className="deadline">
          <span className={`pill ${episode.live_at ? 'bad' : ''}`}>
            <span className="dot" />
            {episode.live_at ? 'On air' : episode.status}
          </span>
          <span className="pill">
            <span className="dot" />
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
          </span>
          {episode.deadline_at && (
            <span className={`pill ${state.picksPublic ? 'ok' : ''}`}>
              <span className="dot" />
              {state.picksPublic ? 'Picks are public' : `Deadline ${ukTime(episode.deadline_at)}`}
            </span>
          )}
        </div>

        {!episode.deadline_at && (
          <p className="notice">
            No deadline set, so nobody can be late and picks stay private. Set the
            air date on the Episodes tab.
          </p>
        )}

        {!episode.live_at && (
          <Confirm
            label="Go live"
            confirmLabel="Yes — go live"
            note="This closes the panel for everyone who hasn't submitted. Only the Episodes tab can undo it."
            busy={busy}
            onConfirm={() => send('goLive')}
          />
        )}
      </Panel>

      <Panel>
        <h2>Who won what</h2>
        <p className="small muted">
          Nobody is an answer, not a switch — pick it the same way you pick a baker.
          Leave a category alone until you know.
        </p>

        <div className="results">
          {episodeCategories.map((c) => (
            <Category
              key={c.key}
              category={c}
              bakers={bakers}
              rows={results.filter((r) => r.category === c.key)}
              busy={busy}
              onSet={(value) => send('setCategory', { category: c.key, value })}
            />
          ))}
        </div>
      </Panel>
    </>
  )
}

/**
 * One category, in the three states that matter:
 *
 *   no rows           — not decided yet —   still to come
 *   a voided row      — Nobody —            nothing happened, nobody scores
 *   winner rows       a baker, or several
 *
 * Not decided and Nobody are different answers and this control keeps them
 * apart: clearing a mistaken pick returns to "not decided", it does not quietly
 * void the category.
 *
 * Extra winners are their own selects. The "add" slot is local state, because
 * an empty slot is not a state the database has — only a chosen baker is sent.
 */
function Category({ category, bakers, rows, busy, onSet }) {
  const [adding, setAdding] = useState(false)

  const voided = rows.some((r) => r.voided)
  const winners = rows.filter((r) => !r.voided).map((r) => r.baker_id)
  const extras = winners.slice(1)

  const options = (exclude) =>
    bakers
      .filter((b) => !exclude.includes(b.id))
      .map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}{b.status === 'eliminated' ? ' (out)' : ''}
        </option>
      ))

  return (
    <div className="result">
      <span className="picker-label">
        {category.label} <span className="muted">+{category.points}</span>
      </span>

      <select
        className={`input ${voided ? 'hatched' : ''}`}
        value={voided ? 'nobody' : (winners[0] ?? '')}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value
          if (v === '') return onSet('undecided')
          if (v === 'nobody') return onSet('nobody')
          onSet([v, ...extras])
        }}
      >
        <option value="">— not decided yet —</option>
        <option value="nobody">— Nobody —</option>
        {options(extras)}
      </select>

      {extras.map((id) => (
        <div className="row" key={id}>
          <select
            className="input"
            value={id}
            disabled={busy}
            onChange={(e) => onSet(winners.map((w) => (w === id ? e.target.value : w)))}
          >
            {options(winners.filter((w) => w !== id))}
          </select>
          <button
            className="btn-mini"
            disabled={busy}
            onClick={() => onSet(winners.filter((w) => w !== id))}
          >
            Remove
          </button>
        </div>
      ))}

      {adding && (
        <div className="row">
          <select
            className="input"
            value=""
            disabled={busy}
            onChange={(e) => {
              if (!e.target.value) return
              setAdding(false)
              onSet([...winners, e.target.value])
            }}
          >
            <option value="">— and who else? —</option>
            {options(winners)}
          </select>
          <button className="btn-mini" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}

      {!adding && winners.length > 0 && (
        <button className="btn-mini" disabled={busy} onClick={() => setAdding(true)}>
          + Add another winner
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------
// Episodes
// ------------------------------------------------------------

function EpisodesTab({ state, send, busy }) {
  const ep = state.episode

  const [form, setForm] = useState(() => formFrom(ep))
  // Re-sync whenever the server's copy changes — a different episode, or the
  // same one after a save. The signature includes deadline_at on purpose: the
  // database derives it from the air date, so after saving a date the form has
  // to show what was actually stored rather than what was typed.
  const signature = episodeSignature(ep)
  const [seen, setSeen] = useState(signature)
  if (seen !== signature) {
    setSeen(signature)
    setForm(formFrom(ep))
  }

  // Only what actually changed is sent. The deadline trigger derives a deadline
  // from the air date ONLY when the same write did not also set the deadline —
  // so a form that posted every field every time would quietly stop deadlines
  // following air dates.
  const patch = {}
  if (form.theme !== (ep.theme ?? '')) patch.theme = form.theme
  if (form.bingo_prompt !== (ep.bingo_prompt ?? '')) patch.bingo_prompt = form.bingo_prompt
  if (form.air_date !== (ep.air_date ?? '')) patch.air_date = form.air_date
  if (form.deadline_at !== toLocalInput(ep.deadline_at)) {
    patch.deadline_at = form.deadline_at ? new Date(form.deadline_at).toISOString() : ''
  }
  if (form.status !== ep.status) patch.status = form.status
  const dirty = Object.keys(patch).length > 0

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })

  return (
    <Panel head={`Episode ${ep.number}${ep.is_final ? ' · the final' : ''}`}>
      <div className="stack">
        <label className="field">
          <span className="picker-label">Theme</span>
          <input className="input" value={form.theme} onChange={set('theme')} placeholder="Cake week" />
        </label>

        <label className="field">
          <span className="picker-label">Air date</span>
          <input className="input" type="date" value={form.air_date} onChange={set('air_date')} />
          <span className="small muted">
            Setting this sets the deadline to 18:00 UK that day, British Summer
            Time included. Clearing it clears the deadline.
          </span>
        </label>

        <label className="field">
          <span className="picker-label">Deadline</span>
          <input
            className="input"
            type="datetime-local"
            value={form.deadline_at}
            onChange={set('deadline_at')}
          />
          <span className="small muted">
            {ep.deadline_at
              ? `Currently ${ukTime(ep.deadline_at)} UK — everyone's picks go public at that moment.`
              : 'No deadline: nobody can be late, and every pick stays private.'}
            {' '}Shown in this device&rsquo;s time zone.
          </span>
        </label>

        <label className="field">
          <span className="picker-label">This week&rsquo;s bingo</span>
          <textarea
            className="input"
            rows={2}
            value={form.bingo_prompt}
            onChange={set('bingo_prompt')}
            placeholder="Someone cries in the tent"
          />
        </label>

        <label className="field">
          <span className="picker-label">Status</span>
          <select className="input" value={form.status} onChange={set('status')} disabled={ep.status === 'live'}>
            <option value="upcoming">Upcoming</option>
            <option value="locked">Locked</option>
            {ep.status === 'live' && <option value="live">Live</option>}
            <option value="complete">Complete</option>
          </select>
          {ep.status === 'live' && (
            <span className="small muted">
              On air. Take it back below to change the status.
            </span>
          )}
        </label>
      </div>

      <div className="actions">
        <button className="btn" disabled={busy || !dirty} onClick={() => send('setEpisode', patch)}>
          {dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      <hr className="rule" />

      {ep.live_at ? (
        <>
          <p className="small">
            <strong>On air since {ukTime(ep.live_at)} UK.</strong> Anyone who hasn&rsquo;t
            submitted is locked out until you open their door.
          </p>
          <Confirm
            label="Take it back"
            confirmLabel="Yes — not live after all"
            note="Going live again later stamps a new time. Entries already marked very late keep that flag — it records when they arrived."
            className="btn btn-quiet"
            busy={busy}
            onConfirm={() => send('goLive', { live: false })}
          />
        </>
      ) : (
        <Confirm
          label="Go live"
          confirmLabel="Yes — go live"
          note="This closes the panel for everyone who hasn't submitted."
          busy={busy}
          onConfirm={() => send('goLive')}
        />
      )}
    </Panel>
  )
}

function formFrom(ep) {
  return {
    theme: ep.theme ?? '',
    bingo_prompt: ep.bingo_prompt ?? '',
    air_date: ep.air_date ?? '',
    deadline_at: toLocalInput(ep.deadline_at),
    status: ep.status,
  }
}

function episodeSignature(ep) {
  return [ep.id, ep.theme, ep.bingo_prompt, ep.air_date, ep.deadline_at, ep.status, ep.live_at].join('|')
}

// ------------------------------------------------------------
// Bits
// ------------------------------------------------------------

/**
 * Two taps for the buttons that are hard to undo. Going live locks everyone
 * out, and taking it back throws away the original timestamp — neither should
 * be one stray thumb away while holding a phone at an angle.
 */
function Confirm({ label, confirmLabel, note, className = 'btn', busy, onConfirm }) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button className={className} disabled={busy} onClick={() => setArmed(true)}>
        {label}
      </button>
    )
  }

  return (
    <>
      {note && <p className="notice">{note}</p>}
      <div className="actions">
        <button
          className="btn"
          disabled={busy}
          onClick={() => { setArmed(false); onConfirm() }}
        >
          {confirmLabel}
        </button>
        <button className="btn btn-quiet" onClick={() => setArmed(false)}>Cancel</button>
      </div>
    </>
  )
}

/** An instant, in the time zone the rules are written in. */
function ukTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** An instant as <input type="datetime-local"> wants it: local, to the minute. */
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
