import { Panel } from './Panel.jsx'
import { Link } from '../lib/Link.jsx'

/**
 * One button per league playing this series — how you look at somebody else's
 * table without being sent its link.
 *
 * At the very bottom, under the recap. Everyone already lands on their own
 * table (resolveLeague), so this is never what someone opened the page for;
 * it is the "how did the other lot do?" after the episode, not the episode.
 *
 * `leagues` is already scoped to the season on screen, which is what keeps the
 * demo leagues off it (src/lib/dashboard.js). With only one there is nothing to
 * switch to, so the panel stays away rather than offering a single button for
 * the page you are already on.
 */
export function LeagueSwitcher({ leagues, shownId }) {
  if (leagues.length < 2) return null

  return (
    <Panel head="Every league">
      <nav className="league-switch" aria-label="Leagues">
        {leagues.map((l) =>
          l.id === shownId ? (
            // Not a link. From "/" it would remount the page to show the same
            // table under a different address.
            <span key={l.id} className="btn-mini" aria-current="page">
              {l.name}
            </span>
          ) : (
            <Link key={l.id} to={`/league/${l.slug}`} className="btn-mini">
              {l.name}
            </Link>
          )
        )}
      </nav>
    </Panel>
  )
}
