import { useEffect, useRef } from 'react'

/**
 * Refresh when the tab comes back to the front, instead of on a timer.
 *
 * TECH_PLAN §8 originally gave the player panel a 20s poll. `/play` is a form
 * you fill in once a week, so that poll would spend roughly 58,000 Vercel
 * invocations across the series keeping a screen up to date that nobody is
 * looking at. Refreshing on focus is fresh the moment you open the tab and
 * silent otherwise — and the countdown, the one thing that genuinely ticks, is
 * local already (useCountdown.js).
 *
 * This is for `/play` only. The dashboard keeps its 4s poll during an episode:
 * points landing live while everyone watches is the whole point of the product,
 * and it reads Supabase directly, so it costs no Vercel invocations at all.
 */
export function useRefreshOnFocus(onRefresh) {
  // The callback is read through a ref so that a caller which rebuilds it every
  // render — one closing over `dirty`, say — does not tear the listeners down
  // and put them back on each pass.
  const latest = useRef(onRefresh)
  useEffect(() => { latest.current = onRefresh }, [onRefresh])

  useEffect(() => {
    let timer = null

    function wake() {
      // `focus` fires on a window that never went away (clicking back into it
      // from another app), and returning to a backgrounded tab fires both
      // events. Coalescing on a short timer means one refresh per return
      // rather than two, and the visibility check drops the case where the
      // window is focused but the tab is not the one on screen.
      if (document.visibilityState !== 'visible') return
      clearTimeout(timer)
      timer = setTimeout(() => latest.current(), 50)
    }

    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [])
}
