// ============================================================
// Entries — who has submitted, the Disallow switch, and the door
// ============================================================
// This lists PLAYERS, not entries. The person who needs a door opened is
// usually the person who has not submitted at all, and they have no entry row
// to appear as — so the roster is the spine and an entry is something a row
// may or may not have.

import { Panel } from '../../components/Panel.jsx'
import { Avatar } from '../../components/Avatar.jsx'
import { ukTime } from './time.js'

const LATENESS = {
  on_time: ['', 'On time'],
  late: ['bad', 'Late'],
  very_late: ['bad', 'Very late'],
}

export function EntriesTab({ state, send, busy }) {
  const { episode, players, entries, leagues, bakers, episodeCategories, picksPublic } = state

  const bakerName = (id) => bakers.find((b) => b.id === id)?.name ?? 'Someone'
  const leagueName = (id) => leagues.find((l) => l.id === id)?.name ?? ''

  const rows = players.map((player) => ({
    player,
    entry: entries.find((e) => e.player_id === player.id) ?? null,
  }))
  const submitted = rows.filter((r) => r.entry && r.entry.picks_made > 0).length

  return (
    <Panel head={`Episode ${episode.number} · entries`}>
      <div className="deadline">
        <span className="pill">
          <span className="dot" />
          {submitted} of {players.length} in
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
          ? 'The deadline has passed, so everyone’s picks are public — including here.'
          : 'You play too, so until the deadline this shows how many picks each person has made and not what they are.'}
      </p>

      {players.length === 0 && (
        <p className="notice">No players yet. Add them on the Players tab.</p>
      )}

      <div className="roster">
        {rows.map(({ player, entry }) => (
          <div className={`roster-row ${entry?.is_disallowed ? 'hatched' : ''}`} key={player.id}>
            <div className="roster-who">
              <Avatar name={player.display_name} colour={player.colour_hex} size={32} />
              <div>
                <strong>{player.display_name}</strong>
                {leagues.length > 1 && (
                  <div className="small muted">{leagueName(player.league_id)}</div>
                )}
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
        ))}
      </div>

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
