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
| **3 — GM panel** | ✅ **Done.** All five tabs. Live and Episodes have been used in a browser; Entries, Players and Bakers are checked against the live database but **not yet looked at** — see below. |
| 4 — scoring wired into `/play` | ⬜ (views already exist; this is display) |
| 5 — dashboard | ⬜ |
| 6 — `/bakers`, `/rules`, top-three picks, stats | ⬜ |
| 7 — avatar builder, visual polish | ⬜ |

Live database state: league **In The Oven** (`in-the-oven`, default), 2 players,
12 placeholder bakers, 10 episodes with no air dates.

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
  _codes.js       normaliseCode + issueCode — canonical; scripts/ calls both
  _wordlists.js   code words + identity colours; splitCode/prettyCode
  _episodes.js    which episode is "this week", which categories apply.
                  Shared: two answers would put the panels on different weeks.
  player.js       login · state · savePicks · confirm. Lateness + lock rules.
  gm.js           state · setCategory · setEpisode · goLive · toggleDisallow ·
                  unlockEntry · upsertPlayer · generateCode · upsertBaker.
                  Password every call.
  health.js       env-var presence check (booleans only, never values)
src/
  App.jsx         routes + nav (/gm is deliberately not in the nav)
  lib/
    supabase.js   browser PostgREST wrapper, read-only, publishable key
    router.js     ~25-line path router (no react-router)
    Link.jsx      internal <a> that keeps cmd-click working
    playerApi.js  /api/player calls + localStorage code
    gmApi.js      /api/gm calls + sessionStorage password
    useCountdown.js
  components/
    Panel.jsx     the default container; optional scalloped icing head
    Avatar.jsx    coloured circle now, assembled SVG in phase 7
  pages/          Dashboard · Play · Bakers · Rules · Gm
    gm/           one file per GM tab; Gm.jsx is only the shell
  styles.css      all design tokens
supabase/         SQL — see supabase/README.md for run order
scripts/
  generate-players.mjs   codes + colours → players.seed.sql (git-ignored)
```

Docs: [RULES.md](RULES.md) (game) · [TECH_PLAN.md](TECH_PLAN.md) (architecture,
data model, phases) · [DESIGN.md](DESIGN.md) (visual system) ·
[supabase/README.md](supabase/README.md) (SQL run order and caveats).

---

## The GM panel: what is built

`/gm` is not in the nav and is not meant to be — bookmark the URL. The password
is posted to `/api/gm` and compared against `process.env.GM_PASSWORD` on **every
single request**. There is no session and no token, and `is_gm` on `players` is
a display flag that this endpoint never consults. It is held in
`sessionStorage`, not `localStorage`: unlike a player's two-word code, one
string here can rewrite every result in the game.

**Live** — the episode-night screen. One control per category, carrying three
states, and the separation between the first two is load-bearing:

```
— not decided yet —   no row.  Dashboard: blank, still to come
— Nobody —            void row. Dashboard: "Nobody", struck through
Baker One …           a winner
```

There is no separate Void switch: **Nobody is the void**, chosen the same way a
winner is. The GM's mental model on the night is "who won this?", and "nobody"
is a legitimate answer to it — a second control is a control to hunt for at
speed. Collapse *not decided* into *Nobody* and clearing a mistaken pick
silently voids the category, mid-episode, unnoticed. **Add another winner** adds
a second select; two eliminations, two handshakes and a bingo catching three
people are all normal.

**Episodes** — theme, air date, deadline, bingo prompt, status, and Go live.

**Entries** — the roster for this episode: who has submitted, how late, the
**Disallow** checkbox and **Open the door**. It lists *players*, not entries,
because the person who needs a door opened is usually the person who has not
submitted at all.

**Players** — add someone, rename them, recolour them, reissue a lost code.
Codes are shown in full; this is the screen you come to when one goes missing.

**Bakers** — rename the placeholders when the cast lands, mark eliminations, set
`finalist` / `winner` at the end.

One API rule worth knowing before you touch either tab:

- **`setCategory` states a category's whole answer** — `'undecided'`,
  `'nobody'`, or a list of winners — and the rows are made to match. It replaced
  the four verbs TECH_PLAN §6 sketched (`setResult · addResult · clearResult ·
  setNobody`) so that "a category is either Nobody or has winners, never both"
  cannot be violated rather than merely being forbidden. Four verbs would each
  have to remember to undo the other kind. If both ever coexist, scoring counts
  the winners and ignores the void (`v_prediction_scores` filters on
  `not voided`), which is also the direction a half-finished write fails in.
- **Only changed fields are sent** by the Episodes tab. The deadline trigger in
  `schema.sql` derives `deadline_at` from `air_date` *only* when the same write
  did not also set `deadline_at` — a form posting every field every time would
  quietly stop deadlines following air dates.
- **The GM sees pick counts, not picks, until the deadline.** Elena plays as
  well as runs it, so the Entries data carries `picks_made` and withholds
  `picks` until `deadline_at` has passed — the same rule as
  `v_public_predictions`, applied at the other end of the wire.
- **Opening a door creates an entry if there isn't one.** `lockState` in
  `api/player.js` reads `gm_unlocked_at` off an entry row, so there has to be
  one. The placeholder takes the default lateness rather than being stamped very
  late up front, because `savePicks` recomputes lateness on every save. Closing
  an unused door deletes it again, so an unlock nobody walked through does not
  leave a phantom 0-point entry in the standings.
- **Recording who left also marks them out of the tent.** They are the same
  fact, and doing only the first leaves an eliminated baker in everyone's picker
  next week. It reverts itself if the answer changes — but only for a baker
  eliminated *in that episode*, which is what keeps a withdrawal recorded by
  hand from being undone by a result that never named them.
- **Codes are issued by `issueCode` in `api/_codes.js`**, which
  `scripts/generate-players.mjs` also calls. No word repeats inside a league
  (codes get read aloud in one room); no code repeats anywhere (`code_norm` is
  globally unique). Reissuing counts the player's current code as part of the
  roster, so the new one shares no word with the old.

---

## Next: phase 4, then the dashboard

**Phase 4 — standings on `/play`.** Each of your picks ticked or crossed once
results land, this week's points, your position and movement. `api/player.js`
already returns your `v_standings` row; the rest is display.

**Phase 5 — the dashboard.** Leaderboard, cumulative points chart, this week's
results grid, prediction wall. League resolution is: an explicit `/league/<slug>`
wins, then the league belonging to the code in `localStorage`, then `is_default`.

**One SQL step is needed for both.** `episode_results` is not anon-readable and
neither phase can show a tick without it — `rls.sql` already anticipates "in
phase 5, a results view". Add `v_episode_results_public` to `views.sql`, grant
it, extend `smoke_test.sql`, and paste both in. A result is a fact about the
episode rather than a pick, so it needs no deadline gate.

Do that work against the granted views with the publishable key, not through a
new endpoint: eight phones refreshing all evening then costs zero Vercel
invocations (TECH_PLAN §8 sets the intervals).

**Leagues** — later; one league is enough for now.

**`supabase/smoke_test.sql` has not been re-run since phase 3 landed.** Nothing
in it changed, but the GM panel now writes into the rules it covers.

---

## Gotchas that cost time here

**No browser in the agent session.** Elena has looked at `/play` and at the GM
panel's Live and Episodes tabs, and those are fine. **The Entries, Players and
Bakers tabs have never been seen by anyone** — they are checked against the
database, not against a pair of eyes. Nothing else has been seen either,
including the scalloped icing, whose geometry is arithmetic done on paper.
`npm run dev` and look, or ask her to. If you have a screenshot tool, use it.

**An eliminated baker disappears from `/play`'s pickers immediately**, and
`savePicks` refuses one (`status=in.(active,finalist,winner)`). Since the
leaving result now marks bakers out as it is entered, that lands mid-episode.
It only reaches a VERY LATE player the GM has unlocked: they cannot save a pick
naming whoever just went. Accepted — they can already see the results anyway.

**You can still test `api/` end to end without a browser.** Import a handler
directly and call it with a fake `req`/`res` — Vercel's handlers are plain
functions, and `vite.config.js` shows the four response helpers they use. Set
`process.env.GM_PASSWORD` *before* the import and `dotenv` will not override it
(it never overwrites an existing variable), so tests run against the real
database with a throwaway password and `.env.local` stays unread. That is how
the 38 checks behind `api/gm.js` were run. Confine writes to a high-numbered
episode, restore what you touched, and re-read to prove it.

**A query string is a place where `&` means something.** Ids from a request body
end up interpolated into PostgREST URLs, so an id of `x&is_gm=eq.true` appends a
filter of the caller's choosing to a query running under the service role.
Everything from a client goes through `isUuid` in `_supabase.js` before it goes
near a URL; anything else (a category key, a status) is checked against the
database's own list first.

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

- **No rate limiting on `/api/player`.** Public wordlists, ~1,200 combinations,
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
