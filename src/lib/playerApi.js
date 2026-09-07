// ============================================================
// Talking to /api/player
// ============================================================
// The code is sent on every request because the server verifies it on every
// request — there is no session. Keeping it in localStorage means your friends
// type it once per device; it is a party-game credential, not a password, and
// it lives in exactly one place so "log out" can actually remove it.

const KEY = 'fbo.code'

export function storedCode() {
  try {
    return localStorage.getItem(KEY) || null
  } catch {
    // Private browsing, or storage disabled. The app still works; it just asks
    // for the code again next time.
    return null
  }
}

export function rememberCode(code) {
  try {
    localStorage.setItem(KEY, code)
  } catch { /* not fatal — see above */ }
}

export function forgetCode() {
  try {
    localStorage.removeItem(KEY)
  } catch { /* not fatal */ }
}

/**
 * Every response is either the full player state or an { error }. Errors are
 * thrown with the server's own message, which is written to be read by a
 * player rather than a developer.
 */
export async function playerPost(action, code, extra = {}) {
  const res = await fetch('/api/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, code, ...extra }),
  })

  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`The server hiccuped (${res.status}). Try again in a moment.`)
  }

  if (!res.ok) throw new Error(data?.error || `Something went wrong (${res.status}).`)
  return data
}
