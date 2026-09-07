/**
 * The GM control room. Built in phase 3.
 *
 * The password is never checked here — it is posted to /api/gm and compared
 * against process.env.GM_PASSWORD on every single request. Nothing gated by
 * this screen may be enforced in the browser.
 */
export default function Gm() {
  return (
    <div className="card">
      <p className="eyebrow">Behind the counter</p>
      <h1>GM panel</h1>
      <p className="muted">Phase 3. Password, then tabs:</p>
      <ul className="stub-list">
        <li><strong>Live</strong> — enter results as the episode airs, void a category</li>
        <li><strong>Episodes</strong> — theme, deadline, bingo prompt, go live</li>
        <li><strong>Entries</strong> — lateness flags, Disallow, open the door</li>
        <li><strong>Players</strong> — codes and colours</li>
        <li><strong>Bakers</strong> — the cast and eliminations</li>
        <li><strong>Leagues</strong> — parallel leagues, and which is default</li>
      </ul>
    </div>
  )
}
