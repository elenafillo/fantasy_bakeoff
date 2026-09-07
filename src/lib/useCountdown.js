import { useSyncExternalStore } from 'react'

// The wall clock is an external store, so it is read through the API React
// provides for external stores. Calling Date.now() in a component body is
// impure — it returns something different on every render — and the snapshot is
// floored to the second so it stays stable between reads within one tick.
function subscribe(onChange) {
  const id = setInterval(onChange, 1000)
  return () => clearInterval(id)
}

const nowToSecond = () => Math.floor(Date.now() / 1000) * 1000

/**
 * A ticking countdown to the deadline.
 *
 * This reads the DEVICE clock, uncorrected, and that is fine: it is decoration.
 * The server decides what counts as late, and it already tells the panel what a
 * save would be flagged as (`wouldBe`) on every load — so a phone with a wrong
 * clock shows a slightly wrong countdown but can never be wrongly marked late,
 * nor wrongly reassured that it wasn't.
 */
export function useCountdown(deadlineIso) {
  const now = useSyncExternalStore(subscribe, nowToSecond, nowToSecond)

  if (!deadlineIso) {
    return { label: 'No deadline yet — the schedule isn’t out', passed: false, ms: null }
  }

  const ms = new Date(deadlineIso).getTime() - now
  if (ms <= 0) return { label: 'Deadline passed', passed: true, ms }

  return { label: `${humanise(ms)} left`, passed: false, ms }
}

function humanise(ms) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)

  // Coarse when it's far away, precise when it matters — nobody needs seconds
  // three days out, and everybody wants them in the last minute.
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}
