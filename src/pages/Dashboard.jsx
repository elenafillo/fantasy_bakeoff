import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { Panel } from '../components/Panel.jsx'

/**
 * The league dashboard, and the app's landing page.
 *
 * Phase 0: a shell plus a live connection check, so we know the URL and key are
 * right before anything is built on top of them.
 *
 * Phase 5 fills it in. League resolution will be: an explicit `slug` prop wins,
 * then the player code in localStorage, then the league flagged `is_default`.
 */
export default function Dashboard({ slug }) {
  const [status, setStatus] = useState('checking')
  const [detail, setDetail] = useState('')

  useEffect(() => {
    let cancelled = false
    supabase
      .ping()
      .then(() => { if (!cancelled) setStatus('ok') })
      .catch((err) => {
        if (cancelled) return
        setStatus('bad')
        setDetail(err.message)
      })
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <Panel head={slug ? `League · ${slug}` : 'The table'}>
        <h1>Nobody has baked anything yet</h1>
        <p className="muted">
          The leaderboard, the points chart and the prediction wall will live
          here. Built in phase 5 — see TECH_PLAN.md.
        </p>
      </Panel>

      <Panel>
        <p className={`pill ${status === 'ok' ? 'ok' : status === 'bad' ? 'bad' : ''}`}>
          <span className="dot" />
          {status === 'checking' && 'Checking Supabase…'}
          {status === 'ok' && 'Supabase connected'}
          {status === 'bad' && 'Supabase unreachable'}
        </p>
        {status === 'bad' && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            {detail} — check <code>SUPABASE_URL</code> and the publishable key in{' '}
            <code>src/lib/supabase.js</code>.
          </p>
        )}
      </Panel>
    </>
  )
}
