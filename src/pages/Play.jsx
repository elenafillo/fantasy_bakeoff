/**
 * The player panel: log in with a two-word code, make this week's five picks,
 * Confirm. Built in phase 2.
 */
export default function Play() {
  return (
    <div className="card">
      <p className="eyebrow">Your panel</p>
      <h1>Predictions open soon</h1>
      <p className="muted">Phase 2. This page will hold:</p>
      <ul className="stub-list">
        <li>Two-word code login, remembered on this device</li>
        <li>The week&rsquo;s five pickers and the bingo prompt</li>
        <li>A countdown to 18:00 Tuesday, and Confirm</li>
        <li>Your top three bakers, from episode 2</li>
        <li>Your running total and week-by-week history</li>
      </ul>
    </div>
  )
}
