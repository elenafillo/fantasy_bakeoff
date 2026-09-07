/**
 * The short, phone-readable version of RULES.md. Built in phase 6 — including
 * the colophon (built with Claude; based on the official Fantasy Bake Off),
 * whose exact wording is still to be confirmed.
 */
export default function Rules() {
  return (
    <div className="card">
      <p className="eyebrow">How it works</p>
      <h1>The rules</h1>
      <p className="muted">Phase 6. The scannable version of RULES.md:</p>
      <ul className="stub-list">
        <li>The points table and the two penalties</li>
        <li>The deadline, and what LATE and VERY LATE mean</li>
        <li>Top three bakers and the end-of-series bonuses</li>
        <li>What happens in weeks that don&rsquo;t behave</li>
      </ul>
    </div>
  )
}
