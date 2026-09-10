import { Panel } from './Panel.jsx'
import { Avatar } from './Avatar.jsx'

/**
 * Everyone's two bakes — RULES §6.
 *
 * IT IS SUPPOSED TO BE EMPTY UNTIL EPISODE 1'S DEADLINE, and it will be empty
 * for every episode in the database today, because none of them has an air date
 * yet. That is `v_series_guesses_public`, whose WHERE clause is the whole of
 * "nobody reads anybody else's guess while still deciding their own", and which
 * fails closed on a null deadline. Nothing here reads `series_guesses`, and
 * nothing should: the panel says which of the reasons applies rather than
 * showing a bare blank.
 *
 * Same shape as the top three board, one episode earlier: these lock and reveal
 * at episode 1's deadline where the three lock and reveal at episode 2's.
 *
 * WHAT IS SHOWN IS WHAT THE PLAYER TYPED, never the GM's canonical form. The
 * two are separate columns for exactly this reason: the tidy-up is
 * scoring-relevant, so the original has to stay on screen beside its
 * consequences.
 */
export function GuessBoard({ guesses, standings, episodeOne }) {
  const byPlayer = new Map()
  for (const row of guesses ?? []) {
    if (!byPlayer.has(row.player_id)) byPlayer.set(row.player_id, [])
    byPlayer.get(row.player_id).push(row)
  }

  if (byPlayer.size === 0) {
    return (
      <Panel head="The bake guess">
        <h2 className="th-board-head">Everyone&rsquo;s two</h2>
        <p className="muted">
          {!episodeOne
            ? 'There is no episode 1 yet, so nobody has guessed.'
            : !episodeOne.deadline_at
              ? 'Episode 1 has no deadline yet, so nobody can be late for it and nobody’s guesses are public. They appear here as soon as the schedule is set.'
              : episodeOne.predictions_public
                ? 'Nobody named a bake before episode 1, so there is nothing riding on this.'
                : 'Two bakes each, named before episode 1. They all appear here the moment its deadline passes.'}
        </p>
      </Panel>
    )
  }

  // Standings order, so the board reads down in the same order as the table.
  const rows = standings.filter((p) => byPlayer.has(p.player_id))

  return (
    <Panel head="The bake guess">
      <h2 className="th-board-head">Everyone&rsquo;s two</h2>
      <p className="small muted">
        Named before episode 1. <strong>+5</strong> if you were the only one who
        said it, <strong>+2</strong> if exactly two of you did — paid the week it
        comes up.
      </p>

      <ul className="th-board">
        {rows.map((p) => (
          <li key={p.player_id} className="th-board-row">
            <div className="th-board-who">
              <Avatar name={p.display_name} colour={p.colour_hex} size={28} />
              <strong className="th-board-name">{p.display_name}</strong>
            </div>
            <ul className="th-board-picks">
              {[...byPlayer.get(p.player_id)]
                .sort((a, b) => a.slot - b.slot)
                .map((row) => (
                  <GuessChip key={row.slot} row={row} />
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * One guess, in one of four states.
 *
 * A hit that paid and a hit that paid nothing must not look alike: the second
 * is the "everyone said cake" case, and it is the funniest thing on this board.
 * Neither is carried by colour alone — the points, or the words, say it too
 * (DESIGN §5).
 */
function GuessChip({ row }) {
  const struck = row.is_disallowed
  const landed = row.hit_episode_number != null
  const paid = landed && row.points > 0

  const state = struck ? 'struck' : paid ? 'paid' : landed ? 'flat' : 'waiting'

  return (
    <li
      className={`th-board-pick guess-chip ${state}`}
      title={
        struck
          ? 'Struck out by the GM'
          : landed
            ? `Came up in episode ${row.hit_episode_number}`
            : 'Still to come up'
      }
    >
      {row.guess_text}
      {landed && !struck && (
        <span className="guess-chip-ep">
          {` · Ep ${row.hit_episode_number}`}
          {paid ? ` · +${row.points}` : ''}
        </span>
      )}
      {struck && <span className="sr-only"> — struck out</span>}
      {landed && !paid && !struck && <span className="sr-only"> — came up, too many said it</span>}
    </li>
  )
}
