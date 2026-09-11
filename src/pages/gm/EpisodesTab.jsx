// ============================================================
// Episodes — theme, air date, the two moments, bingo prompt, status
// ============================================================
// TWO MOMENTS, ONE DATE: the deadline closes the picks at 18:00, and the lock
// closes the panel at 20:00 when the episode goes on air. Both are derived from
// the air date by schema.sql's trigger and both are editable here for a week
// that behaves oddly.
//
// The lock used to be a "Go live" button pressed mid-episode. It is a field now
// because a rule nobody can forget beats a rule somebody has to remember.

import { useState } from 'react'
import { Panel } from '../../components/Panel.jsx'
import { ukTime, toLocalInput, isOnAir } from './time.js'

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
  if (form.live_at !== toLocalInput(ep.live_at)) {
    patch.live_at = form.live_at ? new Date(form.live_at).toISOString() : ''
  }
  if (form.status !== ep.status) patch.status = form.status
  const dirty = Object.keys(patch).length > 0

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value })
  const onAir = isOnAir(ep, state.serverNow)

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
              ? `Currently ${ukTime(ep.deadline_at)} UK — picks close, and anything saved after it costs the player 2 points.`
              : 'No deadline: nobody can be late, and nobody is charged for not entering.'}
            {' '}Shown in this device&rsquo;s time zone.
          </span>
        </label>

        {/* The hard lock AND the reveal, and it used to be a button. "Go live"
            stamped this with the server clock when the GM pressed it mid-episode
            — so RULES §2.5's promise that the panel locks when the episode
            starts rested on somebody remembering. It is derived from the air
            date now and sits here beside the deadline, because the two are the
            same kind of thing: one closes the picks and prices lateness, the
            other closes the panel and publishes every card. Moving this moves
            when the league sees each other's picks, which is worth knowing
            before nudging it for an episode that airs late. */}
        <label className="field">
          <span className="picker-label">Locks at</span>
          <input
            className="input"
            type="datetime-local"
            value={form.live_at}
            onChange={set('live_at')}
          />
          <span className="small muted">
            {ep.live_at
              ? `Currently ${ukTime(ep.live_at)} UK — everyone's picks go public at that moment, and after it only players you open a door for can submit.`
              : 'No lock: nobody is shut out, and every pick stays private.'}
            {' '}Set from the air date at 20:00. Change it for a week that airs
            at an odd hour — though moving the air date afterwards will reset it,
            the same as it does the deadline.
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
          {/* Three values, and only one of them does anything: COMPLETE is what
              moves everyone on to next week. Upcoming and Locked are labels —
              selecting "Locked" does not lock the panel, the time above does.
              The old 'live' value is gone: whether an episode is on air is a
              comparison now, not something to set and forget. */}
          <select className="input" value={form.status} onChange={set('status')}>
            <option value="upcoming">Upcoming</option>
            <option value="locked">Locked</option>
            <option value="complete">Complete</option>
          </select>
          <span className="small muted">
            {onAir
              ? 'On air now. Mark it Complete when you have finished entering the results — that moves everyone on to next week.'
              : 'Complete is the one that counts: it moves /play and the table on to the next episode. The panel locks itself at the time above.'}
          </span>
        </label>
      </div>

      <div className="actions">
        <button className="btn" disabled={busy || !dirty} onClick={() => send('setEpisode', patch)}>
          {dirty ? 'Save' : 'Saved'}
        </button>
      </div>

      {onAir && (
        <>
          <hr className="rule" />
          <p className="small">
            <strong>On air since {ukTime(ep.live_at)} UK.</strong> Anyone who
            hasn&rsquo;t submitted is locked out until you open their door on the
            Entries tab.
          </p>
        </>
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
    live_at: toLocalInput(ep.live_at),
    status: ep.status,
  }
}

function episodeSignature(ep) {
  return [ep.id, ep.theme, ep.bingo_prompt, ep.air_date, ep.deadline_at, ep.status, ep.live_at].join('|')
}
