import { Panel } from './Panel.jsx'
import { Avatar } from './Avatar.jsx'
import { HowToRead, Note } from './HowToRead.jsx'
import { topThreeStats } from '../lib/topThree.js'

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
 *
 * The numbers sit beside the board on a wide screen and under it on a phone —
 * counted in src/lib/topThree.js from the same rows, so they need no query and
 * inherit the same gate.
 */
export function TopThreeBoard({ topPicks, standings, episodeTwo }) {
  // A pick the GM disallowed is not one the room holds (src/lib/topThree.js).
  const live = (topPicks ?? []).filter((r) => !r.is_disallowed)
  const byPlayer = new Map()
  for (const row of live) {
    if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, [])
    byPlayer.get(row.player_id).push(row)
  }

  if (byPlayer.size === 0) {
    return (
      <Panel head="The top three">
        <h2 className="th-board-head">Everyone&rsquo;s top three</h2>
        <p className="muted">
          {!episodeTwo
            ? 'There is no episode 2 yet, so nobody has committed to a top three.'
            : episodeTwo.live_at
              ? 'Everyone’s top three appear here the moment episode 2 starts airing.'
              : 'Episode 2 has no date yet, so nobody can be late for it and nobody’s three are public. They appear here as soon as the schedule is set.'}
        </p>
      </Panel>
    )
  }

  // Standings order, so the board reads down in the same order as the table
  // right above it rather than in whatever order the rows arrived.
  const rows = standings.filter((p) => byPlayer.has(p.player_id))
  const stats = topThreeStats(live)

  return (
    <Panel head="The top three">
      <h2 className="th-board-head">Everyone&rsquo;s three</h2>
      <p className="small muted">
        Locked in before episode 2. +3 each for reaching the final, +6 if one of
        them wins it.
      </p>

      <div className="th-split">
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

        {stats && <TopThreeStats stats={stats} />}
      </div>

      <HowToRead>
        <Note term={<span className="th-board-pick gone">Baker</span>}>
          Struck through and greyed: that baker has left the tent. The same in
          the counts beside the board.
        </Note>
      </HowToRead>
    </Panel>
  )
}

/** The three counts beside the board. Plain props; topThree.js does the sums. */
function TopThreeStats({ stats }) {
  const { mentions, combos, stillIn } = stats
  const most = mentions[0]?.count ?? 1

  return (
    <aside className="th-stats" aria-label="The top three in numbers">
      <section>
        <h3 className="th-stats-head">Most named</h3>
        <ul className="th-mentions">
          {mentions.map((m) => (
            <li key={m.baker_id} className={`th-mention ${m.gone ? 'gone' : ''}`}>
              <span className="th-mention-name" title={m.gone ? `${m.name} has left the tent` : undefined}>
                {m.name}
                {m.gone && <span className="sr-only"> — out</span>}
              </span>
              {/* Decorative: the count beside it carries the number. */}
              <span className="th-mention-bar" aria-hidden="true">
                <span style={{ width: `${(m.count / most) * 100}%` }} />
              </span>
              <span className="th-mention-count">{m.count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="th-stats-head">Shared threes</h3>
        {combos.length === 0 ? (
          <p className="small muted th-stats-none">No two people picked the same three.</p>
        ) : (
          <ul className="th-combos">
            {combos.map((c) => (
              <li key={c.key} className="th-combo">
                <ul className="th-board-picks">
                  {c.bakers.map((b) => (
                    <li
                      key={b.baker_id}
                      className={`th-board-pick ${b.gone ? 'gone' : ''}`}
                      title={b.gone ? `${b.name} has left the tent` : undefined}
                    >
                      {b.name}
                      {b.gone && <span className="sr-only"> — out</span>}
                    </li>
                  ))}
                </ul>
                <span className="small muted">held by {c.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="th-stats-head">Still in the tent</h3>
        <ul className="th-stillin">
          {stillIn.map((b) => (
            <li key={b.bakers} className={`th-stillin-cell ${b.players === 0 ? 'empty' : ''}`}>
              <strong className="th-stillin-n">{b.players}</strong>
              <span className="th-stillin-label">
                {b.players === 1 ? 'player' : 'players'} with{' '}
                {b.bakers === 0 ? 'none' : b.bakers === 3 ? 'all 3' : b.bakers} in
              </span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
