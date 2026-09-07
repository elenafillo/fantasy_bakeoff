// ============================================================
// GET /api/health — phase-0 plumbing check
// ============================================================
// Confirms the serverless runtime is up and that the three environment
// variables are actually set in whichever environment you're hitting. Local and
// Vercel are configured separately, so "it works on my machine" is a real
// failure mode here and this is how you tell them apart.
//
// It reports only whether each value is PRESENT — never the value, never a
// prefix, never a length. A secret that leaks through a debug endpoint is still
// leaked. `serviceKeyWorks` proves the key is valid by using it, which is the
// only honest test and reveals nothing.
//
// Safe to leave deployed, but there is no reason to: delete it once phase 1 has
// real tables to read.

import { SUPABASE_URL, serviceHeaders } from './_supabase.js'

export default async function handler(req, res) {
  const env = {
    SUPABASE_URL: Boolean(SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    GM_PASSWORD: Boolean(process.env.GM_PASSWORD),
  }

  let serviceKeyWorks = false
  let detail = null

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      // A real table, not the `/rest/v1/` OpenAPI root. The root answers for a
      // service key but 401s for a publishable one, so probing it would report
      // health that the browser does not actually have — and it says nothing
      // about whether the schema exists.
      const probe = await fetch(`${SUPABASE_URL}/rest/v1/categories?select=key&limit=1`, {
        headers: serviceHeaders(),
      })
      serviceKeyWorks = probe.ok
      if (!probe.ok) detail = `${probe.status} ${probe.statusText}`
    } catch (err) {
      detail = err.message
    }
  } else {
    detail = 'Missing environment variables.'
  }

  const ok = Object.values(env).every(Boolean) && serviceKeyWorks
  return res.status(ok ? 200 : 503).json({ ok, env, serviceKeyWorks, detail })
}
