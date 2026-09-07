# Fantasy Bake Off

A fantasy league for the Great British Bake Off. Players predict each week's Star
Baker, elimination, technical winner, handshake and a GM-written bingo event;
points land live as the episode airs.

- **[HANDOFF.md](HANDOFF.md)** — **start here.** State of play, what's next, and the traps
- **[RULES.md](RULES.md)** — how the game is played and scored
- **[TECH_PLAN.md](TECH_PLAN.md)** — architecture, data model, build phases
- **[DESIGN.md](DESIGN.md)** — the visual system
- **[supabase/README.md](supabase/README.md)** — SQL run order

**Stack:** React + Vite · Supabase (Postgres) · Vercel

## Pages

| Route | Who | What | Phase |
|-------|-----|------|------:|
| `/` | anyone | Dashboard — your league if you're logged in, else the default one | 5 |
| `/play` | player | Prediction panel, two-word code login — **built** | 2 ✅ |
| `/bakers` | anyone | The cast grid | 6 |
| `/rules` | anyone | Short-form rules | 6 |
| `/gm` | GM | Password-gated control room — **next** | 3 |

## Dev

```bash
npm install
npm run dev            # localhost:5173 — the whole app, including /api/*
npm run dev -- --host  # also on the local network, for testing on a phone
npm run lint
npm run build
```

`npm run dev` serves `api/*.js` too, via a dev-only plugin in
[vite.config.js](vite.config.js), so there's no second process to run. `vercel
dev` is the more faithful runtime but crashes on Node 24 / Windows with a libuv
assertion — use a preview deploy to cross-check instead.

Visit `/api/health` to confirm the environment variables are set and the service
role key works. It reports presence only, never values.

## Environment

Copy [.env.example](.env.example) to `.env.local` (git-ignored) and fill in the
three variables. The same three are set in the Vercel dashboard under Project →
Settings → Environment Variables — they're configured separately, so check
`/api/health` in both places.

`SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security completely. It is read
only in `api/_supabase.js` and must never be imported under `src/`. The
publishable key in `src/lib/supabase.js` is public by design and ships in the
bundle.
