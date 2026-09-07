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
