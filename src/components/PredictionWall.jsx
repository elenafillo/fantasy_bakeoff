import { Panel } from './Panel.jsx'
import { Avatar } from './Avatar.jsx'
import { Mark } from './Mark.jsx'
import { signed, verdictFor } from '../lib/scores.js'
import { usePopKey } from '../lib/usePopKey.js'
import { useCountdown } from '../lib/useCountdown.js'
import { HowToRead, Note } from './HowToRead.jsx'

/**
 * Everyone's picks, ticking as the results land. The bit people shout at.
 *
 * IT IS SUPPOSED TO BE EMPTY BEFORE THE DEADLINE, and it will be empty for
 * every episode in the database today, because none of them has a deadline yet.
 * That is the system working. The rows come from v_public_predictions, whose
 * WHERE clause is the whole of "nobody sees your picks early" and which fails
 * closed on a null deadline — an episode nobody can be late for is one whose
 * picks stay private. Nothing here reads `predictions` or `entries`, and
 * nothing here may.
 *
 * A table: players down, the week's points beside the name, then the
 * categories across. It scales where cards don't — sixteen players is sixteen
 * rows you can scan in one look, and reading down a column ("everyone said
 * Priya") is the thing people actually do with a prediction wall.
 *
 * The cost is width. Seven columns will not fit a phone at a size where a
 * baker's name is readable, so the table is sized for readability and scrolls
 * sideways, with the player column pinned — the pattern that keeps a row
 * identifiable once its name has scrolled off. That makes it the second element
 * allowed to scroll sideways, where DESIGN §6 reserved that for the chart; §6
 * is marked as sketched and expected to change once there was real data in it,
 * and this is that.
 *
 * The cells mark wrong picks as well as right ones, which the scorecard on
 * /play deliberately doesn't — see Mark.jsx. There, prose says what happened
 * and a wrong pick recedes because it costs nothing. Here a cell is a name in a
 * box with no room for a sentence, so the tint would be carrying the meaning on
 * its own, and colour never does that (DESIGN §5).
 *
 * `episode` IS NOT ALWAYS THE CURRENT ONE. A week marked complete keeps its
 * wall until the day before the next deadline (pickWall, src/lib/dashboard.js),
 * and `nextEpisode` is set for exactly those days.
 */
export function PredictionWall({
  categories, predictions, standings, bakerNames, results, scores, episode, nextEpisode, meId,
}) {
  // Counts to the REVEAL, not to the deadline — this panel's only job while the
  // picks are sealed is to say when they stop being sealed, and since RULES §2.5
  // split the two moments that is 20:00 and not 18:00.
  const countdown = useCountdown(episode?.live_at)

  if (!episode) return null

  // The episode rides in the band on both faces of the panel. Now that the
  // wall can be showing last week's picks, every wall has to say which week.
  const head = `The wall · Episode ${episode.number}`

  if (!episode.predictions_public) {
    return (
      <Panel head={head}>
        <h2>Everyone’s picks are hidden</h2>
        <p className="muted">
          {episode.live_at
            ? `They all appear here the moment episode ${episode.number} starts airing — ${countdown.label.toLowerCase()}.`
            : `Episode ${episode.number} has no date yet, so nobody can be late for it and nobody’s picks are public. They appear here as soon as the schedule is set.`}
        </p>
      </Panel>
    )
  }

  return (
    <Panel head={head}>
      {/* Said in words, not left to the number in the band: everything above
          this panel has already moved on to the next episode, so a wall that
          hasn't needs to say so where the eye lands. */}
      {nextEpisode && (
        <p className="notice">
          These are everyone&rsquo;s picks for Episode {episode.number} (which is
          now finished). They will come down the day before
          episode {nextEpisode.number}.
        </p>
      )}
      <div className="scroll-x wall-scroll">
        <table className="wall-table">
          <thead>
            {/* Only the avatar pins — about 2.4rem rather than the whole name
                column, so more of a phone's width is actual data. The name
                scrolls away with everything else; the disc's colour and initial
                are what keep the row identifiable, and the full name is one
                swipe back. */}
            <tr>
              <th scope="col" className="wall-face"></th>
              <th scope="col" className="wall-name">Player</th>
              <th scope="col" className="wall-score">Week</th>
              {categories.map((c) => (
                <th key={c.key} scope="col">
                  <span aria-hidden="true">{shortLabel(c.label)}</span>
                  <span className="wall-worth" aria-hidden="true">+{c.points}</span>
                  <span className="sr-only">{c.label}, {c.points} points</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {standings.map((player) => (
              <Row
                key={player.player_id}
                player={player}
                categories={categories}
                picks={predictions.filter((p) => p.player_id === player.player_id)}
                bakerNames={bakerNames}
                results={results}
                week={scores.find((s) => s.player_id === player.player_id && s.episode_id === episode.id) ?? null}
                isMe={player.player_id === meId}
              />
            ))}
          </tbody>
        </table>
      </div>

      <HowToRead>
        <Note term="Baker names">
          For each player, their guess in that category.
        </Note>
        <Note term="It scrolls sideways">
          Seven columns will not fit a phone at a readable size.
        </Note>
        <Note term={<Mark glyph="✓" label="right" />}>
          They named the baker who won it.
        </Note>
        <Note term={<Mark glyph="✗" label="wrong" />}>
          They named someone else (no penalty).
        </Note>
        <Note term={<span className="howto-swatch penalised">&minus;1</span>}>
          They earned a penalty by guessing star baker as leaving baker, or viceversa. 
        </Note>
        <Note term={<span className="howto-swatch hatched">&nbsp;</span>}>
          No baker fullfilled the category, so nobody could get it right.
        </Note>
        <Note term={<span className="howto-swatch">&mdash;</span>}>
          The player did not make a guess for this category.
        </Note>
        <Note term={<span className="howto-swatch pending">&nbsp;</span>}>
          Still to come.
        </Note>
        <Note term="Late &minus;2">
          Submitted after six o&rsquo;clock on the day, which costs two points.
          Their picks still score as normal.
        </Note>
        <Note term="Disallowed">
          The GM has manually disallowed this entry.
        </Note>
      </HowToRead>
    </Panel>
  )
}

function Row({ player, categories, picks, bakerNames, results, week, isMe }) {
  const pops = usePopKey(week?.points ?? null)
  // Lateness and the GM's disallow switch belong to the entry, so every one of
  // a player's rows carries the same answer.
  const entry = picks[0] ?? null
  const byCategory = Object.fromEntries(picks.map((p) => [p.category, p.baker_id]))

  return (
    <tr className={`${entry?.is_disallowed ? 'disallowed ' : ''}${isMe ? 'me' : ''}`}>
      {/* The one pinned cell. Decorative rather than the row's header: the name
          beside it is what a screen reader should announce for each cell, and
          the avatar is already aria-hidden. */}
      <td className="wall-face">
        <Avatar name={player.display_name} colour={player.colour_hex} size={26} />
      </td>

      <th scope="row" className="wall-name">
        <span className="wall-nm">{player.display_name}</span>
        {/* "You" goes under the name rather than beside it: a tag alongside
            would either push the name out or be eaten by its ellipsis. The row
            is tinted too, but the word is what carries it — colour never does
            that alone. */}
        <span className="wall-flags">
          {isMe && <span className="flag you">You</span>}
          {/* The cost rides with the flag. LATE was a label until RULES §2.5
              put a price on it, and a wall that still showed the bare word made
              the −2 in the score column look unexplained. */}
          {entry?.lateness === 'late' && <span className="flag">Late &minus;2</span>}
          {entry?.lateness === 'very_late' && <span className="flag">Very late &minus;2</span>}
          {entry?.is_disallowed && <span className="flag">Disallowed</span>}
        </span>
      </th>

      <td className="wall-score">
        <span key={pops} className={`score-number${pops > 0 ? ' popped' : ''}`}>
          {week ? signed(week.points) : '—'}
        </span>
      </td>

      {entry ? (
        categories.map((c) => (
          <Cell
            key={c.key}
            category={c}
            pick={byCategory[c.key] ?? null}
            bakerNames={bakerNames}
            results={results}
            // Which pick cost a point, straight from v_episode_scores. Never
            // worked out here: that would be a second implementation of a
            // scoring rule, free to drift from the one that pays out.
            penalty={(week?.penalties ?? []).find((p) => p.category === c.key) ?? null}
          />
        ))
      ) : (
        <td className="wall-noentry" colSpan={categories.length}>No entry this week</td>
      )}
    </tr>
  )
}

/**
 * One pick. The states are the scorecard's states, from the same function:
 *
 *   right    tick, mint     nobody    hatched — the category paid no one
 *   wrong    cross, grey    pending   blank behind a stitch border
 *   nopick   they left it blank, but the category is settled, which is not the
 *            same thing as "still to come"
 *
 * Two lines rather than one, because a category column is about 44px wide on a
 * phone: the mark gets the top line and the whole width goes to the name.
 */
function Cell({ category, pick, bakerNames, results, penalty }) {
  const { state } = verdictFor(category.key, pick, results)
  const name = pick ? bakerNames[pick] ?? 'gone' : null

  return (
    <td className={`wall-cell ${state}${penalty ? ' penalised' : ''}`}>
      <span className={`wall-pick${state === 'nobody' ? ' hatched' : ''}`}>
        <span className="wall-mark">
          {penalty && <span className="wall-cost">{signed(penalty.points)}</span>}
          {!penalty && state === 'right' && <Mark glyph="✓" label="right" />}
          {!penalty && state === 'wrong' && <Mark glyph="✗" label="wrong" />}
        </span>
        <span className="wall-who-picked">{name ?? <span className="muted">—</span>}</span>
      </span>
    </td>
  )
}

/**
 * "Leaving Baker" → "Leaving". The column is 44px wide and the full label is
 * read out by the sr-only span beside it.
 *
 * Derived rather than mapped, because categories are configuration and not
 * code — a sixth one is a row in the table, and a lookup here would be one more
 * place that has to hear about it (TECH_PLAN §3).
 */
function shortLabel(label) {
  const first = label.split(' ')[0]
  return first.length > 9 ? `${first.slice(0, 8)}…` : first
}
