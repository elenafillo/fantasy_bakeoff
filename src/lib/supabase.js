// ============================================================
// Supabase client (browser)
// ============================================================
// A hand-rolled PostgREST wrapper — the supabase-js SDK is not installed and is
// not needed for this.
//
// The publishable key below is public by design: it ships inside the JS bundle,
// so anyone can read it and craft their own requests. Everything it can reach is
// therefore read-only by RLS, and predictions are reachable only through views
// that filter on `live_at <= now()` — the episode's broadcast, not its deadline.
// All writes go through the service-role serverless functions in /api.
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

  // Connectivity check for the shell.
  //
  // It reads a real granted view rather than the `/rest/v1/` OpenAPI root:
  // Supabase returns 401 on that root for publishable keys, so probing it
  // reported a broken connection on a perfectly healthy database. Reading
  // v_categories_public proves three things at once — the URL resolves, the key
  // is accepted, and the schema has actually been applied.
  async ping() {
    const rows = await this.query('v_categories_public', { select: 'key', limit: 1 })
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('Connected, but there are no categories — has seed.sql been run?')
    }
    return true
  },

  // Not realtime — a plain poll. Callers pass their own interval.
  subscribe(callback, intervalMs = 4000) {
    const id = setInterval(callback, intervalMs)
    return () => clearInterval(id)
  },
}
