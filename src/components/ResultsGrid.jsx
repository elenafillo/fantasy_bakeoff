import { Panel } from './Panel.jsx'
import { nameList, verdictFor } from '../lib/scores.js'
import { HowToRead, Note } from './HowToRead.jsx'

/**
 * What happened this week, filling in category by category as the GM enters it.
 *
 * THREE STATES, and keeping the first two apart is the point of the component
 * (RULES §3, DESIGN §7):
 *
 *   no row at all              not decided yet   plainly blank, stitch border
 *   one voided row, no baker   Nobody won it     hatched, struck through
 *   a row with a baker         a winner          named
 *
 * Two winners in a category is normal — two eliminations, three bingo hits — so
 * this names all of them. Naming any one of them scored, once.
 *
 * verdictFor with no pick is reused rather than reimplemented: with pickId null
 * it answers the question this grid asks — was this decided, and by whom — and
 * it is the function the scorecard and the wall already agree with.
 *
 * TECH_PLAN §5 wanted the winning baker's face here. There are no photos yet,
 * and v_episode_results_public carries the name and not photo_url, so this
 * names them. Faces are a column and a phase away.
 *
 * `last` marks the week just finished, which the dashboard keeps in a box of
 * its own above the current one until the next deadline (pickShown in
 * dashboard.js). It drops the how-to-read notes, which the box below carries.
 */
export function ResultsGrid({ categories, results, episode, last = false }) {
  if (!episode) return null

  // Computed in v_episodes_public from the lock time, not a status somebody had
  // to remember to set as the episode began.
  const live = episode.is_live
  const title = `${last ? 'Last episode · ' : 'Episode '}${episode.number}`

  return (
    <Panel head={`${title}${episode.theme ? ` · ${episode.theme}` : ''}`}>
      <div className="resmeta">
        {live && (
          <span className="pill bad live-pulse">
            <span className="dot" />
            Live now
          </span>
        )}
        {episode.status === 'complete' && (
          <span className="pill"><span className="dot" />Finished</span>
        )}
        {episode.bingo_prompt && (
          <p className="bingo">
            <span className="eyebrow">{last ? 'Last week’s bingo' : 'This week’s bingo'}</span>
            {episode.bingo_prompt}
          </p>
        )}
      </div>

      <div className="resgrid">
        {categories.map((c) => {
          const { state, winners } = verdictFor(c.key, null, results)
          return (
            <div key={c.key} className={`rescell ${state}`}>
              <span className="picker-label">
                {c.label} <span className="muted">+{c.points}</span>
              </span>
              <span className={`rescell-body${state === 'nobody' ? ' hatched' : ''}`}>
                {winners.length > 0 && nameList(winners.map((w) => w.baker_name))}
                {state === 'nobody' && <s>Nobody</s>}
                {state === 'pending' && <span className="muted">Still to come</span>}
              </span>
            </div>
          )
        })}
      </div>

      {!last && <HowToRead>
        <Note term="A name">
          The baker that won the category. Two names means it was shared, and naming either one of them scores in full.
        </Note>
        <Note term={<span className="howto-swatch hatched"><s>Nobody</s></span>}>
          No baker fullfilled this category (e.g. no handsake was given).
        </Note>
        <Note term={<span className="howto-swatch pending">Still to come</span>}>
          Not decided yet, or not announced yet. 
        </Note>
        <Note term="+3 beside a category">
          The points to be awarded from a correct guess in that category.
        </Note>
        <Note term="Live now">
          The episode is on air, so this panel is refreshing every few seconds.
        </Note>
      </HowToRead>}
    </Panel>
  )
}
