# Fantasy Bake Off — Project Handoff

Everything a new contributor needs to pick this up. Read this, then
[TECH_PLAN.md](TECH_PLAN.md) for the architecture and [RULES.md](RULES.md) for
the game.

**Stack:** React + Vite · Supabase (Postgres) · Vercel
**Repo:** https://github.com/elenafillo/fantasy_bakeoff
**Owner / GM:** Elena

---

## What it is

A fantasy league for the Great British Bake Off, for Elena and her friends.
Players predict each week's Star Baker, elimination, technical winner, Hollywood
handshake and a GM-written bingo event. Points land **live as the episode airs**,
which is the whole point — the leaderboard moves while everyone watches.

The series has **ten episodes**. The start date has not been announced (expected
late September 2026), so nothing is time-pressured yet.

---

## Where it is now

| Phase | State |
|---|---|
| **0 — scaffold** | ✅ Done, deployed |
| **1 — schema, views, RLS, seed** | ✅ Done, applied to the live database, smoke test passes |
| **2 — player panel** | ✅ Done, verified end to end by Elena logging in and making picks |
| **3 — GM panel** | ⬜ **Next.** See below. |
| 4 — scoring wired into `/play` | ⬜ (views already exist; this is display) |
| 5 — dashboard | ⬜ |
| 6 — `/bakers`, `/rules`, top-three picks, stats | ⬜ |
| 7 — avatar builder, visual polish | ⬜ |

Live database state: league **In The Oven** (`in-the-oven`, default), 1 player
(Elena, GM), 12 placeholder bakers, 10 episodes with no air dates.

---

## The three things that matter most

**1. `supabase/views.sql` is a permission boundary, not just queries.**
The browser's publishable key can read a handful of granted views and nothing
else. Every table is RLS-enabled with no anon policies and all grants revoked.
The views are security-definer *on purpose* — that is what lets them expose a
filtered slice of tables the browser cannot touch. Adding a column or loosening a
`WHERE` there publishes data to the internet.

The single load-bearing line:

```sql
where ep.deadline_at is not null    -- fails closed: no deadline set = not public
  and ep.deadline_at <= now();
```

That is the whole of "nobody sees your picks before the deadline". Episodes are
seeded with a null date, so failing closed is not theoretical.

**2. Rules live on the server, never in the UI.**
`api/player.js` recomputes lateness and the lock from the server clock on every
request. The countdown, disabled buttons and LATE banner in `/play` are
conveniences. A browser can lie about the time; a disabled button can be
re-enabled from devtools.

**3. `SUPABASE_SERVICE_ROLE_KEY` must never be imported under `src/`.**
It bypasses RLS entirely. It is read only in `api/_supabase.js`. The publishable
key in `src/lib/supabase.js` is public by design and ships in the bundle.

---

## File map

```
api/
  _supabase.js    service-role REST helpers. THE SECRET LIVES HERE ONLY.
  _codes.js       normaliseCode — canonical; scripts/ imports it from here
  player.js       login · state · savePicks · confirm. Lateness + lock rules.
  health.js       env-var presence check (booleans only, never values)
src/
  App.jsx         routes + nav
  lib/
    supabase.js   browser PostgREST wrapper, read-only, publishable key
    router.js     ~25-line path router (no react-router)
    Link.jsx      internal <a> that keeps cmd-click working
    playerApi.js  /api/player calls + localStorage code
    useCountdown.js
  components/
    Panel.jsx     the default container; optional scalloped icing head
    Avatar.jsx    coloured circle now, assembled SVG in phase 7
  pages/          Dashboard · Play · Bakers · Rules · Gm
  styles.css      all design tokens
supabase/         SQL — see supabase/README.md for run order
scripts/
  generate-players.mjs   codes + colours → players.seed.sql (git-ignored)
  wordlists.mjs
```

Docs: [RULES.md](RULES.md) (game) · [TECH_PLAN.md](TECH_PLAN.md) (architecture,
data model, phases) · [DESIGN.md](DESIGN.md) (visual system) ·
[supabase/README.md](supabase/README.md) (SQL run order and caveats).

---

## Next: phase 3, the GM panel

`/gm` currently renders a stub. It is the last thing standing between this and a
playable week-one game — without it there is no way to enter results, so nothing
ever scores.

Build `api/gm.js` (service role, password checked against
`process.env.GM_PASSWORD` on **every** request — no sessions, no tokens) and
flesh out `src/pages/Gm.jsx` with tabs:

- **Live** — the episode-night screen, and the one that deserves the most care.
  Pick a category, pick a baker, done. Four taps per result, big touch targets,
  works one-handed on a phone from a sofa. Needs **Add another winner** (two
  eliminations, two handshakes, a bingo that catches three people are all normal)
  and a **Void** switch per category.
- **Episodes** — theme, air date, deadline, bingo prompt, and the
  `upcoming → locked → live → complete` status. "Go live" stamps `live_at`,
  which is the hard lock.
- **Entries** — every entry with its lateness flag, the **Disallow** checkbox,
  and **Open the door** (sets `entries.gm_unlocked_at`) to let one player submit
  after the episode has started.
- **Players** — add players, issue codes, set colours.
- **Bakers** — rename the placeholders when the cast is announced, mark
  eliminations, set `finalist` / `winner` at the end.
- **Leagues** — later; one league is enough for now.

Endpoints sketched in TECH_PLAN §6: `setResult · addResult · voidCategory ·
setEpisode · goLive · setBingoPrompt · toggleDisallow · unlockEntry ·
upsertPlayer · upsertBaker · createLeague · generateCode`.

Two invariants the API must hold that the schema does not:

- **A category is either voided or has winners, never both.** `voidCategory`
  must delete the winner rows. If both exist, scoring silently ignores the void
  (`v_prediction_scores` filters on `not voided`).
- **Setting a baker to `eliminated` should set `eliminated_episode`.**
  `v_baker_stats.weeks_survived` reads it.

After phase 3, re-run `supabase/smoke_test.sql` — it covers the scoring rules the
GM panel writes into.

---

## Gotchas that cost time here

**No browser in the agent session.** Nothing has been visually verified — not the
scalloped icing (its geometry is arithmetic done on paper), not the player panel.
`npm run dev` and look. If you have a screenshot tool, use it.

**PowerShell mangles double quotes passed to native executables.** A commit
message containing `"` gets split into separate arguments and git reports
nonsense pathspec errors. Write the message to a file and use `git commit -F`.

**Supabase 401s on `/rest/v1/` for publishable keys.** The PostgREST OpenAPI root
is not readable with the browser key, though every granted view is. A health
check that probes it reports a broken connection on a perfectly healthy database
— this cost an hour. Probe a real relation.

**`RAISE NOTICE` does not surface in the Supabase SQL editor.** A passing test
that reports via notice looks identical to one that did nothing. `smoke_test.sql`
returns its verdict as a `SELECT` after the rollback for exactly this reason.

**Check the dev server port.** `npm run dev` silently moves to 5174 if 5173 is
taken by another project, and a request to 5173 then hits the wrong app. Use
`--port N --strictPort`, and never kill node processes by matching `vite` — that
takes out the user's other work.

**`npm run lint` is clean and should stay that way.** React's newer rules reject
`setState` synchronously inside effects and impure calls like `Date.now()` during
render. Both came up in phase 2 and both had real fixes — don't reach for a
disable comment.

---

## Working agreements with Elena

- **Don't read `.env*` files.** She manages secrets herself. Ask for public
  values (project URL, publishable key) in chat, and verify environment setup
  with `/api/health`, which reports presence as booleans.
- She reviews plans before implementation and edits the `.md` files directly —
  re-read them rather than assuming your last version stands.
- Commit and push when asked; she watches the Vercel deploy and checks on her
  phone.
- Flag trade-offs rather than silently choosing. The no-rate-limiting decision
  (below) is the model: state it, recommend, let her decide.

---

## Known limitations, accepted

- **No rate limiting on `/api/player`.** Public wordlists, ~1,600 combinations,
  so codes are enumerable; a failed login sleeps 400ms. Accepted for a league of
  friends — codes are cheap to reissue and predictions go public at the deadline.
  Fix if needed: a `login_attempts` table keyed by IP.
- **The chart can show at most four colours at once.** Not a style choice — a
  fifth series measures ΔE 7.1 to ordinary vision against a floor of 15.
  DESIGN.md §6 builds the three-state line model around it.
- **The identity palette (16 colours) has not been validated.** It doesn't need
  the chart's gate because those colours always sit beside a name, but it's owed
  a pass.
- **`is_gm` is a display flag**, not authorisation. The GM panel is gated by the
  password alone.
