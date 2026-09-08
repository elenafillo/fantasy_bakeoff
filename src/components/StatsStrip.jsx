import { Panel } from './Panel.jsx'

/**
 * Five things worth knowing, from data already on the page (src/lib/stats.js).
 *
 * OPEN by default, unlike the recap — Elena's call, and the right one: these
 * are the lines people read out loud, and a stat nobody opens is a stat nobody
 * has. TECH_PLAN §5 originally asked for it collapsed on a phone; it stays a
 * <details> so it can still be shut, but shut is no longer the default.
 *
 * Bakers first, then players (src/lib/stats.js). The halves answer different
 * questions and reading them mixed together was five unrelated facts.
 *
 * Cards with nothing to say are not rendered at all, so before the first result
 * this whole panel stays away rather than showing five dashes.
 */
export function StatsStrip({ stats }) {
  if (!stats || stats.length === 0) return null

  return (
    <Panel>
      <details className="recap stats" open>
        <summary>
          The numbers — {stats.length} thing{stats.length === 1 ? '' : 's'} worth knowing
        </summary>
        <ul className="stat-grid">
          {stats.map((s) => (
            <li key={s.key} className="stat">
              <span className="stat-label">{s.label}</span>
              <strong className="stat-value">{s.value}</strong>
              <span className="stat-detail">{s.detail}</span>
            </li>
          ))}
        </ul>
      </details>
    </Panel>
  )
}
