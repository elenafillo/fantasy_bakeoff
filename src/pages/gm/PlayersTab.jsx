// ============================================================
// Players — the roster, the codes, the colours
// ============================================================
// Codes are shown in full here on purpose: this is the screen you come to when
// someone has lost theirs (TECH_PLAN §13). They are issued by the server and
// never generated in the browser — a credential the client invents is a
// credential the client controls.
//
// One of the two league-scoped tabs. With several leagues running, the roster
// is grouped under their names rather than listed flat — see gm/leagueScope.js.

import { useState } from 'react'
import { Panel } from '../../components/Panel.jsx'
import { Avatar } from '../../components/Avatar.jsx'
import { Confirm } from './Confirm.jsx'
import { ALL, groupByLeague } from './leagueScope.js'

export function PlayersTab({ state, send, busy, leagueId = ALL }) {
  const { players, leagues } = state
  const colours = state.colours ?? []
  const [adding, setAdding] = useState(false)

  // Deliberately over EVERY player and not the ones on screen: a colour is
  // unique within its league whether or not that league is being looked at.
  const takenIn = (id) =>
    players.filter((p) => p.league_id === id).map((p) => (p.colour_hex ?? '').toLowerCase())

  const groups = groupByLeague(players, leagues, leagueId)
  const headed = groups.length > 1
  const shown = groups.reduce((n, g) => n + g.people.length, 0)

  return (
    <Panel head="Players">
      <p className="small muted">
        Send each person only their own line. Codes are case- and
        punctuation-insensitive, so &ldquo;Velvet Crumb&rdquo; and
        &ldquo;velvetcrumb&rdquo; both work.
      </p>

      {shown === 0 && (
        <p className="notice">
          {leagueId === ALL
            ? 'Nobody yet. Add the first player below.'
            : 'Nobody in this league yet. Add the first player below.'}
        </p>
      )}

      {groups.map(({ league, people }) => (
        <section className="roster-section" key={league.id}>
          {headed && (
            <p className="roster-group">
              {league.name}
              <span className="muted">
                {' · '}{people.length} player{people.length === 1 ? '' : 's'}
              </span>
            </p>
          )}
          <div className="roster">
            {people.map((player) => (
              <PlayerRow
                key={player.id}
                player={player}
                colours={colours}
                taken={takenIn(player.league_id)}
                busy={busy}
                send={send}
              />
            ))}
          </div>
        </section>
      ))}

      <hr className="rule" />

      {adding ? (
        <NewPlayer
          leagues={leagues}
          colours={colours}
          takenIn={takenIn}
          // Whichever league is being looked at, so filtering to one and then
          // adding somebody does not quietly put them in another.
          startIn={leagueId === ALL ? null : leagueId}
          busy={busy}
          send={send}
          onDone={() => setAdding(false)}
        />
      ) : (
        <button className="btn" disabled={busy} onClick={() => setAdding(true)}>
          Add a player
        </button>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------

// The league is not repeated on the row: when several are in view the group
// heading above carries it, and when one is, the picker in the shell does.
function PlayerRow({ player, colours, taken, busy, send }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => shape(player))

  function open() {
    setForm(shape(player))
    setEditing(true)
  }

  function save() {
    setEditing(false)
    send('upsertPlayer', {
      playerId: player.id,
      display_name: form.display_name,
      colour_hex: form.colour_hex,
      is_gm: form.is_gm,
    })
  }

  return (
    <div className="roster-row">
      <div className="roster-who">
        <Avatar name={player.display_name} colour={player.colour_hex} size={32} />
        <div>
          <strong>{player.display_name}</strong>
          <div className="small muted">
            <span className="code-chip">{player.code}</span>
            {player.is_gm && ' · GM'}
          </div>
        </div>
      </div>

      {editing ? (
        <div className="stack">
          <label className="field">
            <span className="picker-label">Name</span>
            <input
              className="input"
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </label>

          <div className="field">
            <span className="picker-label">Colour</span>
            <Swatches
              colours={colours}
              taken={taken}
              value={form.colour_hex}
              busy={busy}
              onChange={(c) => setForm({ ...form, colour_hex: c })}
            />
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={form.is_gm}
              onChange={(e) => setForm({ ...form, is_gm: e.target.checked })}
            />
            Runs the league
          </label>
          <p className="small muted">
            A badge, not a permission — the GM panel is gated by the password alone.
          </p>

          <div className="actions">
            <button className="btn" disabled={busy || !form.display_name.trim()} onClick={save}>
              Save
            </button>
            <button className="btn btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="roster-actions">
          {/* A direct toggle, not a field in the edit form. "Who still owes me
              a fiver" is a question you answer by running down the roster, and
              Edit → tick → Save is three taps to change one boolean. Same
              shape, and the same reasoning, as Disallow on the Entries tab.

              It stays on this tab and this tab only: the column is absent from
              v_players_public, so nothing on the dashboard can show it even by
              accident. Owing money is not a thing to publish to the league. */}
          <label className="check">
            <input
              type="checkbox"
              checked={Boolean(player.has_paid)}
              disabled={busy}
              onChange={(e) =>
                send('upsertPlayer', { playerId: player.id, has_paid: e.target.checked })
              }
            />
            Paid
          </label>
          <button className="btn-mini" disabled={busy} onClick={open}>Edit</button>
          <Confirm
            className="btn-mini"
            label="New code"
            confirmLabel={`Yes — reissue ${player.display_name}'s code`}
            note="Their old code stops working immediately, including on any device they are already signed in on."
            busy={busy}
            onConfirm={() => send('generateCode', { playerId: player.id })}
          />
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------

function NewPlayer({ leagues, colours, takenIn, startIn, busy, send, onDone }) {
  const [leagueId, setLeagueId] = useState(startIn ?? leagues[0]?.id ?? '')
  const taken = takenIn(leagueId)
  const [name, setName] = useState('')
  const [colour, setColour] = useState(
    () => colours.find((c) => !takenIn(startIn ?? leagues[0]?.id).includes(c)) ?? ''
  )

  // Switching league can make the chosen colour unavailable — a colour is only
  // unique within a league, so the same hex may be free in one and taken in
  // another.
  const free = colours.filter((c) => !taken.includes(c))
  const value = free.includes(colour) ? colour : (free[0] ?? '')

  return (
    <div className="stack">
      <h2>A new player</h2>

      {leagues.length > 1 && (
        <label className="field">
          <span className="picker-label">League</span>
          <select
            className="input"
            value={leagueId}
            onChange={(e) => setLeagueId(e.target.value)}
          >
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span className="picker-label">Name</span>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sam"
        />
      </label>

      <div className="field">
        <span className="picker-label">Colour</span>
        <Swatches colours={colours} taken={taken} value={value} busy={busy} onChange={setColour} />
        <span className="small muted">
          Theirs everywhere — their line on the chart, their row on the table,
          their name on the prediction wall.
        </span>
      </div>

      {free.length === 0 && (
        <p className="notice">
          Every colour in the palette is taken in this league. Add more to
          IDENTITY_COLOURS in api/_wordlists.js before adding another player.
        </p>
      )}

      <div className="actions">
        <button
          className="btn"
          disabled={busy || !name.trim() || !value || !leagueId}
          onClick={() => {
            onDone()
            send('upsertPlayer', { leagueId, display_name: name, colour_hex: value, is_gm: false })
          }}
        >
          Add and issue a code
        </button>
        <button className="btn btn-quiet" onClick={onDone}>Cancel</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------

/**
 * The identity palette. A swatch carries a tick or a cross as well as its
 * colour, because colour never carries information on its own here (DESIGN §5)
 * — and "which of these is already Sam's" is information.
 */
function Swatches({ colours, taken, value, busy, onChange }) {
  return (
    <div className="swatches">
      {colours.map((c) => {
        const isTaken = taken.includes(c) && c !== value
        const isMine = c === value
        return (
          <button
            key={c}
            type="button"
            className="swatch"
            style={{ background: c }}
            aria-label={`${c}${isTaken ? ', already taken' : ''}`}
            aria-pressed={isMine}
            disabled={busy || isTaken}
            onClick={() => onChange(c)}
          >
            {isMine ? '✓' : isTaken ? '×' : ''}
          </button>
        )
      })}
    </div>
  )
}

function shape(player) {
  return {
    display_name: player.display_name,
    colour_hex: (player.colour_hex ?? '').toLowerCase(),
    is_gm: Boolean(player.is_gm),
  }
}
