// ============================================================
// Talking to /api/gm
// ============================================================
// The password goes with every request because the server checks it on every
// request — there is no session, deliberately.
//
// sessionStorage, not localStorage: unlike a player's two-word code, this one
// string can rewrite every result in the game, and the panel gets opened on
// whatever phone or laptop is to hand. Closing the tab closes the panel. The
// cost is retyping it if the tab is lost mid-episode, which is the right way
// round for the only credential that matters.

const KEY = 'fbo.gm'

export function storedPassword() {
  try {
    return sessionStorage.getItem(KEY) || null
  } catch {
    // Private browsing, or storage disabled. The panel still works; it just
    // asks again.
    return null
  }
}

export function rememberPassword(password) {
  try {
    sessionStorage.setItem(KEY, password)
  } catch { /* not fatal — see above */ }
}

export function forgetPassword() {
  try {
    sessionStorage.removeItem(KEY)
  } catch { /* not fatal */ }
}

/**
 * Every response is either the full GM state or an { error }.
 *
 * The status rides along on the thrown error because 401 means something the
 * others don't: the password is wrong, so the panel should ask again. A 500 or
 * a dropped connection must NOT throw away a password that was working — on
 * episode night that would mean retyping it one-handed to carry on.
 */
export async function gmPost(action, password, extra = {}) {
  const res = await fetch('/api/gm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, password, ...extra }),
  })

  let data
  try {
    data = await res.json()
  } catch {
    const err = new Error(`The server hiccuped (${res.status}). Try again in a moment.`)
    err.status = res.status
    throw err
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Something went wrong (${res.status}).`)
    err.status = res.status
    throw err
  }
  return data
}
