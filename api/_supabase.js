// ============================================================
// Shared server-side Supabase access
// ============================================================
// The leading underscore keeps Vercel from routing this as an endpoint.
//
// SUPABASE_SERVICE_ROLE_KEY bypasses RLS entirely. It exists only here, on the
// server. It must never be imported into anything under src/ — that would ship
// it in the browser bundle and hand every player write access to the database,
// including the ability to read everyone else's predictions before the deadline.

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

export const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/**
 * Safely read a JSON request body.
 *
 * `req.body` is a lazy getter on Vercel: it parses on first access and THROWS on
 * malformed input. Destructuring it directly (`const { x } = req.body`)
 * therefore throws out of the handler — a 500 in production, and locally it
 * takes the dev server down.
 *
 * Returns null when the body is unparseable, so callers can answer 400.
 */
export function jsonBody(req) {
  try {
    return req.body ?? {}
  } catch {
    return null
  }
}

/**
 * Ids from a request body end up interpolated into PostgREST query strings, and
 * a query string is a place where `&` means something. An id of
 * `x&is_gm=eq.true` would append a filter of the caller's choosing to a query
 * running under the service role. Everything from a client is checked with this
 * before it goes near a URL.
 */
export function isUuid(v) {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export function serviceHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
}

// PostgREST helper: GET a table with a raw query string, e.g.
//   rest('players', 'select=*&code_norm=eq.velvetcrumb')
export async function rest(path, query = '') {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${path}${query ? `?${query}` : ''}`,
    { headers: serviceHeaders() }
  )
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`PostgREST ${path} → ${res.status}: ${data?.message || JSON.stringify(data)}`)
  }
  return data
}

// Insert, or upsert when `onConflict` names the unique constraint to merge on
// (PostgREST defaults to the primary key otherwise, which is never what we
// want here — the constraints that matter are entries(player_id, episode_id)
// and predictions(entry_id, category)).
//
// Only the columns present in `body` are written, so an upsert cannot silently
// clear a field it does not mention — is_disallowed and gm_unlocked_at survive
// a player re-saving their picks.
export async function restInsert(path, body, { onConflict = null } = {}) {
  const headers = serviceHeaders()
  if (onConflict) headers.Prefer = 'return=representation,resolution=merge-duplicates'
  const url = `${SUPABASE_URL}/rest/v1/${path}${onConflict ? `?on_conflict=${onConflict}` : ''}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`PostgREST insert ${path} → ${res.status}: ${data?.message || JSON.stringify(data)}`)
  }
  return data
}

export async function restPatch(path, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${query}`, {
    method: 'PATCH',
    headers: serviceHeaders(),
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(`PostgREST patch ${path} → ${res.status}: ${data?.message || JSON.stringify(data)}`)
  }
  return data
}

export async function restDelete(path, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${query}`, {
    method: 'DELETE',
    headers: serviceHeaders(),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(`PostgREST delete ${path} → ${res.status}: ${data?.message || JSON.stringify(data)}`)
  }
}

// Call a Postgres function (RPC). For anything where a read-check-write must
// happen inside one transaction.
export async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: serviceHeaders(),
    body: JSON.stringify(args),
  })
  return res.json()
}
