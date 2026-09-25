import { Panel } from './Panel.jsx'
import { categoriesFor } from '../lib/dashboard.js'
import { nameList, verdictFor } from '../lib/scores.js'

/**
 * Every week so far, most recent first.
 *
 * It earns its place by covering a real gap rather than by being decorative:
 * the results grid follows the same "lowest episode not yet complete" rule as
 * /play, and its "Last episode" box only holds a finished week until the next
 * deadline (pickShown in dashboard.js). After that, last night's ticks are gone
 * from both. This is where they go, and it is nearly free —
 * v_episode_results_public carries season_id, so the whole season already
 * arrived in the query the grid needed.
 *
 * Collapsed behind a tap, which is what TECH_PLAN §5 asks for on a phone. Same
 * on a wide screen: it is the least live thing here, and one tap is cheap.
 *
 * Only episodes with something in them appear. An episode with no results is
 * not a week with nothing in it — it is a week that hasn't happened.
 */
export function SeriesRecap({ episodes, results, categories }) {
  const played = episodes
    .filter((e) => results.some((r) => r.episode_id === e.id))
    .sort((a, b) => b.number - a.number)

  if (!played.length) return null

  return (
    <Panel head="Every week so far">
      <details className="recap">
        <summary>
          {played.length === 1 ? 'One week' : `${played.length} weeks`} recorded — show what happened
        </summary>

        {played.map((episode) => {
          const mine = results.filter((r) => r.episode_id === episode.id)
          return (
            <div key={episode.id} className="recap-week">
              <h3>
                Episode {episode.number}
                {episode.theme && <span className="muted"> · {episode.theme}</span>}
              </h3>
              <dl className="recap-list">
                {categoriesFor(categories, episode).map((c) => {
                  const { state, winners } = verdictFor(c.key, null, mine)
                  return (
                    <div key={c.key} className={`recap-row ${state}`}>
                      <dt>{c.label}</dt>
                      <dd className={state === 'nobody' ? 'hatched' : ''}>
                        {winners.length > 0 && nameList(winners.map((w) => w.baker_name))}
                        {state === 'nobody' && <s>Nobody</s>}
                        {state === 'pending' && <span className="muted">—</span>}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </div>
          )
        })}
      </details>
    </Panel>
  )
}
