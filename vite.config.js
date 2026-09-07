import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * Serve api/*.js during `npm run dev`, the way Vercel serves them in
 * production — so one command runs the whole app, player routes and API alike.
 *
 * Why this exists: `vercel dev` crashes on Node 24 / Windows with a libuv
 * assertion (`!(handle->flags & UV_HANDLE_CLOSING)`), taking the server down on
 * the first function invocation. This sidesteps it and needs no dependency.
 *
 * Dev only — `configureServer` never runs during `vite build`, and in
 * production Vercel serves api/ natively. It is a convenience, not a
 * reimplementation: if behaviour here ever disagrees with production, trust
 * production and check against a preview deploy.
 */
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()

        const name = req.url.split('?')[0].slice('/api/'.length)
        // Underscore-prefixed files are shared modules, not endpoints — the
        // same rule Vercel applies.
        if (!/^[a-z0-9-]+$/i.test(name)) return next()
        if (!existsSync(join(ROOT, 'api', `${name}.js`))) return next()

        let raw = ''
        req.on('data', (chunk) => { raw += chunk })
        req.on('end', async () => {
          // Vercel's response helpers, which the handlers expect.
          res.status = (code) => { res.statusCode = code; return res }
          res.json = (payload) => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(payload))
            return res
          }
          res.send = (payload) => {
            res.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
            return res
          }

          try {
            req.body = raw ? JSON.parse(raw) : {}
          } catch {
            return res.status(400).json({ error: 'Malformed JSON body.' })
          }

          try {
            // ssrLoadModule picks up edits to api/*.js without a restart.
            const mod = await server.ssrLoadModule(`/api/${name}.js`)
            await mod.default(req, res)
          } catch (err) {
            server.config.logger.error(`[local-api] /api/${name} failed: ${err.stack || err.message}`)
            if (!res.writableEnded) res.status(500).json({ error: err.message })
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
})
