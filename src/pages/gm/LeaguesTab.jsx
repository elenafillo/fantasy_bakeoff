// ============================================================
// Leagues — the parallel tables
// ============================================================
// Last in the tab bar on purpose. A league is set up once and then not touched
// again, unlike Live, which is read at speed in a dark room — so it sits past
// the tabs that get used weekly rather than in front of them.
//
// Player counts are worked out here rather than fetched: buildState already
// sends every player in the season with their league_id, so this is a filter
// over data the panel is holding anyway.

import { useState } from 'react'
import { Panel } from '../../components/Panel.jsx'
import { Confirm } from './Confirm.jsx'
import { byLeagueOrder } from './leagueScope.js'

export function LeaguesTab({ state, send, busy }) {
  const { leagues, players } = state
  const [adding, setAdding] = useState(false)

  const countIn = (id) => players.filter((p) => p.league_id === id).length
  const activeCount = leagues.filter((l) => l.is_active).length

  /**
   * Why Archive is unavailable, or null when it isn't.
   *
   * The default league cannot be archived — "/" has to land somewhere, and the
   * endpoint refuses it. That refusal is worth SAYING rather than expressing by
   * hiding the button: a control that is simply absent reads as a missing
   * feature, and the one league in a new season is always the default, so
   * hiding it means nobody ever sees an Archive button at all.
   */
  const archiveBlock = (league) => {
    if (!league.is_default) return null
    return activeCount < 2
      ? 'The only league, and “/” has to land somewhere.'
      : 'Make another league the default first — “/” has to land somewhere.'
  }

  // Archived leagues sink to the bottom, the way eliminated bakers do on the
  // Bakers tab. They are still real; they are just not what you came here for.
  const rows = [...leagues].sort(byLeagueOrder)

  return (
    <Panel head="Leagues">
      <p className="small muted">
        Every league plays the same season — one cast, one set of episodes, one
        deadline, and results you type once. A league owns only its own players
        and its own table, so running a second one costs nothing on the night.
      </p>

      {leagues.length === 0 && (
        <p className="notice">No leagues yet. The first one you add becomes the default.</p>
      )}

      <div className="roster">
        {rows.map((league) => (
          <LeagueRow
            key={league.id}
            league={league}
            count={countIn(league.id)}
            archiveBlock={archiveBlock(league)}
            busy={busy}
            send={send}
          />
        ))}
      </div>

      <hr className="rule" />

      {adding ? (
        <NewLeague
          busy={busy}
          send={send}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button className="btn" disabled={busy} onClick={() => setAdding(true)}>
          Add a league
        </button>
      )}

      <p className="small muted" style={{ marginTop: '1rem', marginBottom: 0 }}>
        <strong>Archiving</strong> takes a league off the dashboard and keeps
        everything else — players, codes, picks, the lot. It is not a lock:
        anyone holding a code can still sign in at <code>/play</code> and submit,
        so archive a finished league rather than one you want to close. There is
        no delete, because deleting a league takes every entry and prediction in
        it with no undo.
      </p>
    </Panel>
  )
}

// ------------------------------------------------------------

function LeagueRow({ league, count, archiveBlock, busy, send }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => shape(league))

  function open() {
    setForm(shape(league))
    setEditing(true)
  }

  function save() {
    setEditing(false)
    send('upsertLeague', { leagueId: league.id, name: form.name, slug: form.slug })
  }

  return (
    <div className={`roster-row ${league.is_active ? '' : 'gone'}`}>
      <div className="roster-who">
        <div>
          <strong>{league.name}</strong>
          <div className="small muted">
            <span className="code-chip">/league/{league.slug}</span>
            {' · '}
            {count} player{count === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      {(league.is_default || !league.is_active) && (
        <div className="deadline">
          {league.is_default && (
            <span className="pill ok">
              <span className="dot" />
              Everyone lands here
            </span>
          )}
          {!league.is_active && (
            <span className="pill">
              <span className="dot" />
              Archived
            </span>
          )}
        </div>
      )}

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
            <span className="picker-label">Link</span>
            <input
              className="input"
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
            <span className="small muted">
              Lives at <code>/league/{slugPreview(form.slug || form.name)}</code>. Changing
              it breaks any link already sent round.
            </span>
          </label>

          <div className="actions">
            <button className="btn" disabled={busy || !form.name.trim()} onClick={save}>
              Save
            </button>
            <button className="btn btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="roster-actions">
          <button className="btn-mini" disabled={busy} onClick={open}>Edit</button>

          {/* A new tab, not a navigation: leaving the console mid-episode to
              look at a table is not a trade anybody wants to make. */}
          {league.is_active && (
            <a
              className="btn-mini"
              href={`/league/${league.slug}`}
              target="_blank"
              rel="noreferrer"
            >
              Open
            </a>
          )}

          {league.is_active && !league.is_default && (
            <button
              className="btn-mini"
              disabled={busy}
              onClick={() => send('upsertLeague', { leagueId: league.id, is_default: true })}
            >
              Make default
            </button>
          )}

          {league.is_active ? (
            archiveBlock ? (
              <>
                <button className="btn-mini" disabled>Archive</button>
                <span className="small muted">{archiveBlock}</span>
              </>
            ) : (
              <Confirm
                className="btn-mini"
                label="Archive"
                confirmLabel={`Yes — archive ${league.name}`}
                note="It comes off the dashboard and keeps everything else. Its players can still sign in with their codes, so this hides a league rather than closing one. Bring it back any time."
                busy={busy}
                onConfirm={() => send('upsertLeague', { leagueId: league.id, is_active: false })}
              />
            )
          ) : (
            <button
              className="btn-mini"
              disabled={busy}
              onClick={() => send('upsertLeague', { leagueId: league.id, is_active: true })}
            >
              Bring it back
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------

function NewLeague({ busy, send, onDone }) {
  const [name, setName] = useState('')
  // Null until the slug is typed in by hand. Until then it follows the name,
  // which is what you want nine times in ten — and the moment it is edited it
  // stops moving, because a link somebody has chosen should not be rewritten
  // by a later change of mind about the name.
  const [slug, setSlug] = useState(null)

  const value = slug ?? slugPreview(name)

  return (
    <div className="stack">
      <h2>A new league</h2>

      <label className="field">
        <span className="picker-label">Name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Proving Drawer"
        />
      </label>

      <label className="field">
        <span className="picker-label">Link</span>
        <input
          className="input"
          value={value}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="the-proving-drawer"
        />
        <span className="small muted">
          {value
            ? <>Its table will be at <code>/league/{slugPreview(value)}</code>.</>
            : 'Filled in from the name, and you can change it.'}
        </span>
      </label>

      <p className="small muted" style={{ margin: 0 }}>
        It starts empty. Add its players on the Players tab — each one gets a
        code, and their code takes them to this table on its own.
      </p>

      <div className="actions">
        <button
          className="btn"
          disabled={busy || !name.trim() || !slugPreview(value)}
          onClick={() => {
            onDone()
            send('upsertLeague', { name, slug: value })
          }}
        >
          Add the league
        </button>
        <button className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------

/**
 * A SECOND COPY of `slugify` in api/gm.js, and deliberately only a preview: the
 * server re-normalises whatever arrives, so this one is never the thing that
 * decides. If the two ever drift, the cost is a preview that reads slightly
 * wrong for a moment, not a league with a link nobody can follow.
 */
function slugPreview(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '')
}

function shape(league) {
  return { name: league.name, slug: league.slug }
}
