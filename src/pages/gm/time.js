// ============================================================
// The time helpers the GM tabs share
// ============================================================
// Separate from Confirm.jsx because a file that exports both a component and a
// plain function breaks fast refresh — the panel would stop hot-reloading
// mid-edit, which is exactly when you are looking at it.

/** An instant, in the time zone the rules are written in. */
export function ukTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Is this episode on air right now?
 *
 * Computed, never stored. There used to be a `status = 'live'` that the GM set
 * by pressing Go live, and a status somebody has to remember to set is a status
 * that is wrong for most of the evening it describes. `live_at` is derived from
 * the air date at 20:00, so this answer needs no maintenance at all.
 *
 * Takes `serverNow` from the GM state rather than reading the browser's clock:
 * the panel gets opened on whatever device is to hand, and one of them will
 * have the wrong time. Nothing here is a rule — api/player.js decides the lock —
 * but a pill saying "On air" an hour early is still worth not shipping.
 */
export function isOnAir(episode, serverNow) {
  if (!episode?.live_at || episode.status === 'complete') return false
  return new Date(episode.live_at) <= new Date(serverNow)
}

/** An instant as <input type="datetime-local"> wants it: local, to the minute. */
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
