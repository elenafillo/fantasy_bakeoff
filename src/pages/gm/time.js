// ============================================================
// The two time formatters the GM tabs share
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

/** An instant as <input type="datetime-local"> wants it: local, to the minute. */
export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
