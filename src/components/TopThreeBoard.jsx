import { Panel } from './Panel.jsx'
import { Avatar } from './Avatar.jsx'

/**
 * Everyone's top three — the running story of the series (RULES §5).
 *
 * IT IS SUPPOSED TO BE EMPTY UNTIL EPISODE 2'S DEADLINE, and it will be empty
 * for every episode in the database today, because none of them has a deadline
 * yet. That is `v_top_picks_public`, whose WHERE clause is the whole of "nobody
 * sees whose three is whose before the reveal" and which fails closed on a null
 * deadline. Nothing here reads `top_picks`, and nothing should: the panel says
 * which of the two reasons applies rather than showing a bare blank.
 *
 * Dead picks are greyed and struck, never dropped. You are stuck with your
 * three even after one goes home, and watching them go is most of the fun.
 */
export function TopThreeBoard({ topPicks, standings, episodeTwo }) {
  const byPlayer = new Map()
  for (const row of topPicks ?? []) {
    if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, [])
    byPlayer.get(row.player_id).push(row)
  }

  if (byPlayer.size === 0) {
    return (
      <Panel head="The top three">
        <h2 className="th-board-head">Everyone&rsquo;s three</h2>
        <p className="muted">
          {!episodeTwo
            ? 'There is no episode 2 yet, so nobody has committed to a top three.'
            : episodeTwo.deadline_at
              ? 'Everyone’s three appear here the moment episode 2’s deadline passes.'
              : 'Episode 2 has no deadline yet, so nobody can be late for it and nobody’s three are public. They appear here as soon as the schedule is set.'}
        </p>
      </Panel>
    )
  }

  // Standings order, so the board reads down in the same order as the table
  // right above it rather than in whatever order the rows arrived.
  const rows = standings.filter((p) => byPlayer.has(p.player_id))

  return (
    <Panel head="The top three">
      <h2 className="th-board-head">Everyone&rsquo;s three</h2>
      <p className="small muted">
        Locked in before episode 2. +3 each for reaching the final, +6 if one of
        them wins it.
      </p>

      <ul className="th-board">
        {rows.map((p) => (
          <li key={p.player_id} className="th-board-row">
            <div className="th-board-who">
              <Avatar name={p.display_name} colour={p.colour_hex} size={28} />
              <strong className="th-board-name">{p.display_name}</strong>
            </div>
            <ul className="th-board-picks">
              {byPlayer.get(p.player_id).map((row) => {
                const gone = row.baker_status === 'eliminated'
                return (
                  <li
                    key={row.baker_id}
                    className={`th-board-pick ${gone ? 'gone' : ''}`}
                    /* Struck AND greyed AND labelled — never colour alone
                       (DESIGN §5). The title carries it for a pointer; the
                       visually-hidden word carries it for everyone else. */
                    title={gone ? `${row.baker_name} has left the tent` : undefined}
                  >
                    {row.baker_name}
                    {gone && <span className="sr-only"> — out</span>}
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
