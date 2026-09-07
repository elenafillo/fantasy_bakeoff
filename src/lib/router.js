// ============================================================
// A very small path router
// ============================================================
// Six routes and no nested layouts, so react-router would be a dependency and a
// bundle for something that is 25 lines. Real paths rather than hashes because
// the league slug belongs in the URL; vercel.json rewrites every non-API path
// to index.html so a refresh on /bakers still works.
//
// The <Link> component lives in Link.jsx — keeping it out of here is what lets
// Vite's fast refresh work on both files.

import { useState, useEffect } from 'react'

/** Programmatic navigation. The synthetic popstate is what re-renders. */
export function navigate(to) {
  if (to === window.location.pathname) return
  window.history.pushState({}, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  return path
}
