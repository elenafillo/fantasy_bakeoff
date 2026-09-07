// ============================================================
// Bakers — the cast
// ============================================================
// Rows stay in sort order rather than sinking the eliminated to the bottom the
// way /bakers does. This is an editing screen: a row that moves the moment you
// mark someone out is a row you then have to find again, and on the night you
// are doing this one-handed while an episode plays.

import { useState } from 'react'
import { Panel } from '../../components/Panel.jsx'

const STATUS = {
  active: ['', 'In the tent'],
  eliminated: ['bad', 'Out'],
  finalist: ['ok', 'Finalist'],
  winner: ['ok', 'Winner'],
}

export function BakersTab({ state, send, busy }) {
  const { bakers, episode } = state
  const [adding, setAdding] = useState(false)

  return (
    <Panel head="The cast">
      <p className="small muted">
        Rename the placeholders when the real cast is announced — their ids stay
        put, so any picks already made against them survive. Marking someone out
        removes them from everyone&rsquo;s picker next week.
      </p>

      {bakers.length === 0 && (
        <p className="notice">Nobody in the tent yet, so there is nothing to pick.</p>
      )}

      <div className="roster">
        {bakers.map((baker) => (
          <BakerRow key={baker.id} baker={baker} episode={episode} busy={busy} send={send} />
        ))}
      </div>

      <hr className="rule" />

      {adding ? (
        <NewBaker busy={busy} send={send} onDone={() => setAdding(false)} />
      ) : (
        <button className="btn" disabled={busy} onClick={() => setAdding(true)}>
          Add a baker
        </button>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------

function BakerRow({ baker, episode, busy, send }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => shape(baker, episode))

  const [pillClass, pillLabel] = STATUS[baker.status] ?? ['', baker.status]

  function open() {
    setForm(shape(baker, episode))
    setEditing(true)
  }

  function save() {
    setEditing(false)
    send('upsertBaker', {
      bakerId: baker.id,
      name: form.name,
      bio_line: form.bio_line,
      photo_url: form.photo_url,
      status: form.status,
      // Sent whatever the status: the server drops it for anyone not
      // eliminated, so the two can never disagree.
      eliminated_episode: form.eliminated_episode,
    })
  }

  return (
    <div className={`roster-row ${baker.status === 'eliminated' ? 'gone' : ''}`}>
      <div className="roster-who">
        <div>
          <strong>{baker.name}</strong>
          {baker.bio_line && <div className="small muted">{baker.bio_line}</div>}
        </div>
      </div>

      <div className="deadline">
        <span className={`pill ${pillClass}`}>
          <span className="dot" />
          {pillLabel}
          {baker.status === 'eliminated' && baker.eliminated_episode
            ? ` · ep ${baker.eliminated_episode}`
            : ''}
        </span>
      </div>

      {editing ? (
        <div className="stack">
          <label className="field">
            <span className="picker-label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <label className="field">
            <span className="picker-label">One line about them</span>
            <input
              className="input"
              value={form.bio_line}
              onChange={(e) => setForm({ ...form, bio_line: e.target.value })}
              placeholder="Laminates everything."
            />
          </label>

          <label className="field">
            <span className="picker-label">Photo</span>
            <input
              className="input"
              value={form.photo_url}
              onChange={(e) => setForm({ ...form, photo_url: e.target.value })}
              placeholder="https://…"
            />
          </label>

          <StatusFields form={form} setForm={setForm} />

          <div className="actions">
            <button className="btn" disabled={busy || !form.name.trim()} onClick={save}>Save</button>
            <button className="btn btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="roster-actions">
          <button className="btn-mini" disabled={busy} onClick={open}>Edit</button>
          {baker.status === 'active' && (
            <button
              className="btn-mini"
              disabled={busy}
              onClick={() =>
                send('upsertBaker', {
                  bakerId: baker.id,
                  status: 'eliminated',
                  eliminated_episode: episode.number,
                })
              }
            >
              Out in ep {episode.number}
            </button>
          )}
          {baker.status === 'eliminated' && (
            <button
              className="btn-mini"
              disabled={busy}
              onClick={() => send('upsertBaker', { bakerId: baker.id, status: 'active' })}
            >
              Back in
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------

function NewBaker({ busy, send, onDone }) {
  const [form, setForm] = useState({ name: '', bio_line: '' })

  return (
    <div className="stack">
      <h2>A new baker</h2>

      <label className="field">
        <span className="picker-label">Name</span>
        <input
          className="input"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Priya"
        />
      </label>

      <label className="field">
        <span className="picker-label">One line about them</span>
        <input
          className="input"
          value={form.bio_line}
          onChange={(e) => setForm({ ...form, bio_line: e.target.value })}
          placeholder="Structural engineer by trade."
        />
      </label>

      <div className="actions">
        <button
          className="btn"
          disabled={busy || !form.name.trim()}
          onClick={() => {
            onDone()
            send('upsertBaker', { name: form.name, bio_line: form.bio_line })
          }}
        >
          Into the tent
        </button>
        <button className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------

/**
 * Status, and the episode that goes with it. The number only appears for an
 * elimination because it only means anything for one — the server clears it for
 * every other status, so the form is showing the rule rather than enforcing it.
 */
function StatusFields({ form, setForm }) {
  return (
    <>
      <label className="field">
        <span className="picker-label">Where they are</span>
        <select
          className="input"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
        >
          <option value="active">In the tent</option>
          <option value="eliminated">Out</option>
          <option value="finalist">Finalist</option>
          <option value="winner">Winner</option>
        </select>
      </label>

      {form.status === 'eliminated' && (
        <label className="field">
          <span className="picker-label">Left in episode</span>
          <input
            className="input"
            type="number"
            min="1"
            value={form.eliminated_episode}
            onChange={(e) => setForm({ ...form, eliminated_episode: e.target.value })}
          />
          <span className="small muted">
            Not always this week&rsquo;s elimination — someone who withdraws still
            left in an episode, and that is the number the stats count from.
          </span>
        </label>
      )}
    </>
  )
}

function shape(baker, episode) {
  return {
    name: baker.name,
    bio_line: baker.bio_line ?? '',
    photo_url: baker.photo_url ?? '',
    status: baker.status,
    eliminated_episode: String(baker.eliminated_episode ?? episode?.number ?? 1),
  }
}
