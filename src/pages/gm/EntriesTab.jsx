// ============================================================
// Entries — who has submitted, the Disallow switch, and the door
// ============================================================
// This lists PLAYERS, not entries. The person who needs a door opened is
// usually the person who has not submitted at all, and they have no entry row
// to appear as — so the roster is the spine and an entry is something a row
// may or may not have.
//
// One of the two league-scoped tabs. With several leagues running, that spine
// is grouped under their names and each group carries its own "3 of 8 in" —
// a single count across every league is a number about nobody. See
// gm/leagueScope.js.

import { Panel } from '../../components/Panel.jsx'
import { Avatar } from '../../components/Avatar.jsx'
import { ukTime } from './time.js'
import { ALL, groupByLeague } from './leagueScope.js'

const LATENESS = {
  on_time: ['', 'On time'],
  late: ['bad', 'Late'],
  very_late: ['bad', 'Very late'],
}

export function EntriesTab({ state, send, busy, leagueId = ALL }) {
  const { episode, players, entries, leagues, bakers, episodeCategories, picksPublic } = state

  const bakerName = (id) => bakers.find((b) => b.id === id)?.name ?? 'Someone'

  const rowsFor = (people) =>
    people.map((player) => ({
      player,
      entry: entries.find((e) => e.player_id === player.id) ?? null,
    }))
  const countIn = (rows) => rows.filter((r) => r.entry && r.entry.picks_made > 0).length

  const groups = groupByLeague(players, leagues, leagueId).map((g) => ({
    ...g,
    rows: rowsFor(g.people),
  }))
  const headed = groups.length > 1
  const all = groups.flatMap((g) => g.rows)

  return (
    <Panel head={`Episode ${episode.number} · entries`}>
      <div className="deadline">
        <span className="pill">
          <span className="dot" />
          {countIn(all)} of {all.length} in
        </span>
        {episode.live_at && (
          <span className="pill bad">
            <span className="dot" />
            On air since {ukTime(episode.live_at)}
          </span>
        )}
      </div>

      <p className="small muted">
        {picksPublic
          ? 'The episode has started, so everyone’s picks are public — including here.'
          : 'You play too, so until the episode airs this shows how many picks each person has made and not what they are. The deadline closing does not open this: you see them when the league does.'}
      </p>

      {all.length === 0 && (
        <p className="notice">
          {leagueId === ALL
            ? 'No players yet. Add them on the Players tab.'
            : 'Nobody in this league yet. Add them on the Players tab.'}
        </p>
      )}

      {groups.map(({ league, rows }) => (
        <section className="roster-section" key={league.id}>
          {headed && (
            <p className="roster-group">
              {league.name}
              <span className="muted">{' · '}{countIn(rows)} of {rows.length} in</span>
            </p>
          )}
          <div className="roster">
            {rows.map(({ player, entry }) => (
              <EntryRow
                key={player.id}
                player={player}
                entry={entry}
                episodeCategories={episodeCategories}
                picksPublic={picksPublic}
                bakerName={bakerName}
                busy={busy}
                send={send}
              />
            ))}
          </div>
        </section>
      ))}

      <hr className="rule" />

      <p className="small muted" style={{ marginBottom: 0 }}>
        <strong>Disallow</strong> takes an entry out of scoring and out of every
        stat, as if it were never made. <strong>Open the door</strong> lets one
        person submit after the episode has started — their entry is stamped VERY
        LATE, and they can already see everyone else&rsquo;s picks, so it
        can&rsquo;t be done quietly.
        {!episode.live_at && ' Nobody is locked out yet; the door only bites once you go live.'}
      </p>
    </Panel>
  )
}

// ------------------------------------------------------------
// One person, and whatever they have or have not submitted
// ------------------------------------------------------------
// The league is not named on the row: when several are in view the group
// heading above carries it, and when one is, the picker in the shell does.

function EntryRow({ player, entry, episodeCategories, picksPublic, bakerName, busy, send }) {
  return (
    <div className={`roster-row ${entry?.is_disallowed ? 'hatched' : ''}`}>
      <div className="roster-who">
        <Avatar name={player.display_name} colour={player.colour_hex} size={32} />
        <div>
          <strong>{player.display_name}</strong>
        </div>
      </div>

      <div className="deadline">
        {!entry ? (
          <span className="pill"><span className="dot" />Nothing submitted</span>
        ) : (
          <>
            <span className={`pill ${LATENESS[entry.lateness]?.[0] ?? ''}`}>
              <span className="dot" />
              {entry.picks_made === 0
                ? 'Nothing submitted'
                : LATENESS[entry.lateness]?.[1] ?? entry.lateness}
            </span>
            {entry.confirmed && (
              <span className="pill ok"><span className="dot" />Confirmed</span>
            )}
            {entry.is_disallowed && (
              <span className="pill bad"><span className="dot" />Disallowed</span>
            )}
          </>
        )}
        {entry?.gm_unlocked && (
          <span className="pill"><span className="dot" />Door open</span>
        )}
      </div>

      {entry && entry.picks_made > 0 && (
        picksPublic && entry.picks ? (
          <ul className="picks-list">
            {episodeCategories.map((c) => (
              <li key={c.key}>
                <span className="muted">{c.label}</span>{' '}
                {entry.picks[c.key] ? bakerName(entry.picks[c.key]) : '—'}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">
            {entry.picks_made} of {episodeCategories.length} chosen
          </p>
        )
      )}

      <div className="roster-actions">
        <label className="check">
          <input
            type="checkbox"
            checked={Boolean(entry?.is_disallowed)}
            disabled={busy || !entry}
            onChange={(e) =>
              send('toggleDisallow', { entryId: entry.id, disallowed: e.target.checked })
            }
          />
          Disallow
        </label>

        <button
          className="btn-mini"
          disabled={busy}
          onClick={() =>
            send('unlockEntry', { playerId: player.id, open: !entry?.gm_unlocked })
          }
        >
          {entry?.gm_unlocked ? 'Close the door' : 'Open the door'}
        </button>
      </div>
    </div>
  )
}
