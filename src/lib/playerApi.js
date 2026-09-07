// ============================================================
// Talking to /api/player
// ============================================================
// The code is sent on every request because the server verifies it on every
// request — there is no session. Keeping it in localStorage means your friends
// type it once per device; it is a party-game credential, not a password, and
// it lives in exactly one place so "log out" can actually remove it.

const KEY = 'fbo.code'
const WHO = 'fbo.who'

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
    localStorage.removeItem(WHO)
  } catch { /* not fatal */ }
}

/**
 * Who the stored code belongs to: `{ playerId, leagueSlug }`.
 *
 * Neither is a secret. Every player id, name and colour is published by
 * v_players_public, and the slug is the thing in the URL of `/league/<slug>`.
 * The credential is the code, and it stays in its own key — this is a cache of
 * two public facts, not a second door.
 *
 * It exists so that `/` can open on YOUR league with YOUR row marked without
 * calling `/api/player`. The dashboard reads the granted views straight from
 * Supabase and polls every 4s all evening (TECH_PLAN §6, §8); the one thing it
 * cannot get that way is which league a code belongs to, because codes are
 * RLS-denied to the browser for the obvious reason. Writing this on login
 * answers that question for free.
 *
 * /play rewrites it on every successful state call, so it follows the GM moving
 * somebody between leagues rather than going stale.
 */
export function storedWho() {
  try {
    const raw = localStorage.getItem(WHO)
    if (!raw) return null
    const who = JSON.parse(raw)
    return who?.playerId && who?.leagueSlug ? who : null
  } catch {
    // Private browsing, or a value written by an older build.
    return null
  }
}

export function rememberWho(who) {
  try {
    localStorage.setItem(WHO, JSON.stringify(who))
  } catch { /* not fatal — the dashboard falls back to the default league */ }
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
