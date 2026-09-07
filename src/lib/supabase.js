// ============================================================
// Supabase client (browser)
// ============================================================
// A hand-rolled PostgREST wrapper — the supabase-js SDK is not installed and is
// not needed for this.
//
// The publishable key below is public by design: it ships inside the JS bundle,
// so anyone can read it and craft their own requests. Everything it can reach is
// therefore read-only by RLS, and predictions are reachable only through views
// that filter on `deadline_at < now()`. All writes go through the service-role
// serverless functions in /api.
//
// Never add a mutation path here that the database itself would not let a
// stranger perform.

export const SUPABASE_URL = 'https://bpmwzxacbwznggkpmbqk.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_j2VzrCArMIlwoA_8ffBt1g_0pC_owxZ'

function headers() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

export const supabase = {
  // Read-only, deliberately. Options are PostgREST query params:
  //   query('bakers', { select: '*', order: 'sort_order', params: { status: 'eq.active' } })
  async query(table, options = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`
    const params = new URLSearchParams()
    if (options.select) params.append('select', options.select)
    if (options.order) params.append('order', options.order)
    if (options.limit) params.append('limit', options.limit)
    if (options.params) {
      for (const [k, v] of Object.entries(options.params)) params.append(k, v)
    }
    if (params.toString()) url += `?${params}`

    const res = await fetch(url, { headers: headers() })
    const data = await res.json()
    // Throw rather than return the error object: callers that guard with
    // `Array.isArray(x) ? x : []` would otherwise turn a permissions or schema
    // failure into "no rows" — a bug that reads as an empty database.
    if (!res.ok) {
      throw new Error(`PostgREST ${table} → ${res.status}: ${data?.message || JSON.stringify(data)}`)
    }
    return data
  },

  // Connectivity check for the phase-0 shell: the REST root answers with an
  // OpenAPI document when the URL and key are both good. Remove once there are
  // real tables to read.
  async ping() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: headers() })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return true
  },

  // Not realtime — a plain poll. Callers pass their own interval.
  subscribe(callback, intervalMs = 4000) {
    const id = setInterval(callback, intervalMs)
    return () => clearInterval(id)
  },
}
