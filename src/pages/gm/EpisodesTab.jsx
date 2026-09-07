// ============================================================
// Episodes — theme, air date, deadline, bingo prompt, status
// ============================================================

import { useState } from 'react'
import { Panel } from '../../components/Panel.jsx'
import { Confirm } from './Confirm.jsx'
import { ukTime, toLocalInput } from './time.js'

export function EpisodesTab({ state, send, busy }) {
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
