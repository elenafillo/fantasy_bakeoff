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
| **4 — scoring wired into `/play`** | ✅ **Done.** SQL applied, smoke test passing, and seen in a browser with real results entered from the GM panel. |
| **5 — dashboard** | ✅ **Done.** Chart, leaderboard, results grid, prediction wall and the series recap. No SQL changes. Looked at on a phone. |
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
    scores.js     the scoring snapshot: results, standings, movement, and the
                  ONE thing the browser derives — the tick. Points never.
    dashboard.js  the dashboard's reads and league resolution — and a SECOND
                  copy of pickCurrent. Change one, change the other.
    useCountdown.js
    useRefreshOnFocus.js   why /play has no poll (TECH_PLAN §8)
    usePopKey.js  restarts the score-change animation; scorecard + leaderboard
  components/
    Panel.jsx     the default container; optional scalloped icing head
    Avatar.jsx    coloured circle now, assembled SVG in phase 7
    Mark.jsx      the tick and the cross, shared by the scorecard and the wall
    Scorecard.jsx how a week went. Plain props, no fetching.
    Leaderboard.jsx  the table, the reorder, and the chart's controls
    PointsChart.jsx  hand-rolled SVG; three line states, table fallback
    ResultsGrid.jsx  this week, in three states that must not look alike
    PredictionWall.jsx  everyone's picks — empty until the deadline, by design
    SeriesRecap.jsx  every week so far, collapsed
  pages/          Dashboard · Play · Bakers · Rules · Gm
    gm/           one file per GM tab; Gm.jsx is only the shell
  styles.css      all design tokens
supabase/         SQL — see supabase/README.md for run order
scripts/
  generate-players.mjs   codes + colours → players.seed.sql (git-ignored)
```

Docs: [RULES.md](RULES.md) (game) · [TECH_PLAN.md](TECH_PLAN.md) (architecture,
data model, phases) · [DESIGN.md](DESIGN.md) (visual system) ·
[ASSETS.md](ASSETS.md) (the art brief) ·
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

## Phase 4: the scorecard on `/play`

✅ **Applied to the live database on 2026-09-07**, smoke test passing, and looked
at in a browser with real results entered from the GM panel.

Phase 4 changed `views.sql`, so if you are setting this up again: paste
`views.sql`, then `rls.sql`, then run `smoke_test.sql`. All three are
idempotent.

One trap for anyone editing those views again: **`create or replace view` may
only APPEND columns.** `v_penalties.category` and `v_episode_scores.penalties`
are both stuck at the end of their column lists rather than beside the columns
they belong with, for exactly that reason — re-ordering means dropping the view,
which cascades to everything downstream and drops the grants with it. Check the
live column order before assuming an edit will paste.

`v_episode_results_public` is what `episode_results` was missing: the browser
could not show a tick without it. It carries the winner's **name** — the browser
cannot look one up, because the leaving baker is out of the tent and gone from
the panel's cast list by the time that result lands — and it carries `voided`,
because three states have to survive the trip:

```
no row at all              not decided yet   plainly blank
one voided row, no baker   Nobody won it     hatched, struck out
a row with a baker         a winner          ticked or crossed
```

The join to `bakers` is a **LEFT** join for exactly that reason. An inner join
drops every Nobody row, which silently collapses the first two states — the bug
DESIGN §7 and `schema.sql` both warn about, and one that stays invisible until
the week it matters. The smoke test asserts the row count, so a reflex change
there fails loudly.

There is **no deadline gate**, unlike `v_public_predictions`, and that is also
asserted: a result is a fact about a broadcast episode, not a pick.

**Points always come from SQL.** `v_episode_scores` and `v_standings` are read
straight from the browser with the publishable key — no endpoint, so eight
phones refreshing all evening costs zero Vercel invocations. The browser derives
exactly one thing, `verdictFor` in [src/lib/scores.js](src/lib/scores.js):
whether the baker you named is one of the bakers who won it. Nothing in `src/`
adds up a category's points, handles a multi-winner category or applies the two
−1 penalties; `v_prediction_scores` and `v_penalties` stay ungranted, and that is
the boundary.

**Including *which* pick cost a point.** The panel names the penalty in words —
"You picked Baker Four for Star Baker, and they went home" — and the temptation
is to work that out in the browser, since the results and the player's own picks
are both right there. Don't: that is a second implementation of a scoring rule,
free to drift from the one that pays out. Instead `v_penalties` carries a
`category` saying which pick brought the penalty on, and `v_episode_scores`
aggregates the reasons into a `penalties` jsonb array. The browser looks up the
row and prints a sentence. If a third penalty is ever added, the panel needs one
new string in `penaltyWording` and nothing else.

**Movement is the one real derivation.** `v_standings` knows only where you
stand now, so last week's table is rebuilt from `v_episode_scores` — points from
the episodes before this one, plus the series bonus, re-ranked with the same
tie-and-skip rule Postgres uses. Two consequences worth knowing: the bonus
appears in both tables, so it never produces movement of its own (there is no
honest alternative — `v_series_bonus` carries no episode); and week one reports
no movement at all rather than telling everybody below the leader they have
fallen.

**`/play` refreshes on focus, not on a timer** — see TECH_PLAN §8, which now
says so. The `/api/player` half of that refresh is skipped while the form has
unsaved changes, because a fresh `state.picks` re-syncs the form and would throw
the edits away silently.

### What the four states look like, and why

| State | Look | Why |
|---|---|---|
| **Right** | mint tint **and** a tick | Mint never appears instead of the tick — colour never carries information alone (DESIGN §5) |
| **Wrong** | greyed, no mark, leads with *"It was Baker Three"* | The ordinary outcome, and it costs nothing, so it recedes. That is what leaves room for the rows that DO cost something |
| **Nobody** | hatched 45° diagonals | Settled, and paid nobody |
| **Still to come** | plainly blank behind a dashed stitch border | Blank and hatched **must not look alike**; that difference is the whole point (DESIGN §7, RULES §3) |

A **penalty** is not a fifth state but a layer on top: red, with the −1 and the
sentence naming the pick. Before that, losing a point looked exactly like missing
one, which was the note Elena sent back — and it is a genuinely different
outcome.

That red **widens `--live` beyond "the episode is airing" and LATE / VERY LATE**,
which DESIGN §3 lists as load-bearing. A deliberate call: losing a point is the
one thing on this panel worth an alarm, it happens at most twice a week, and it
never shares a screen region with the live indicator. **DESIGN §4's reservation
line is therefore out of date** — see the note at the end of this file.

The hatch stripe also changed, from `--line` to the ink at 18% alpha. `--line`
measured 1.15:1 against white as a 2px stripe, which is not a signal. Texture
strength sits in DESIGN §3's "free" column, but it also changes the GM Live
tab's voided select, which is the other place `.hatched` is used.

### What phase 4 does not cover

**The scorecard shows one episode** — the current one, meaning the
lowest-numbered not `complete`. There is no week switcher and no scrolling. So
the moment you mark an episode complete on the Episodes tab, `/play` moves on to
next week and last night's ticks disappear from it; the running total in the
header stays. Phase 5's series recap is where the history belongs, and the data
is already in `v_episode_scores`. If you want to look at a week for a while,
leave it `live` rather than `complete`.

**Discussed and deferred:** a one-line "your weeks so far" strip on `/play`
(`Ep 1 · 1 · Ep 2 · 7 …`). Nearly free — `fetchScoreboard` already pulls every
episode's points for the movement maths, so it is markup only. Left out so it
does not become a second dashboard; ask Elena before adding it.

## Phase 5: the dashboard

✅ **Done.** Chart, leaderboard, results grid, prediction wall and the series
recap, at `/` and `/league/<slug>`. **No SQL changed**, so there is nothing to
paste and the smoke test is unaffected.

**Still no endpoint, and that is the point.** Everything reads granted views
with the publishable key, so this page on a screen all evening plus eight phones
in the room costs zero Vercel invocations — which is what makes the 4s poll
affordable (TECH_PLAN §6, §8). It polls on a timer where `/play` refreshes on
focus, and the two are opposites deliberately: points landing live while
everyone watches is the whole product, and nobody will tab away and back to find
out whether Star Baker has been called. 4s while the episode is `live`, 30s
otherwise.

`src/lib/dashboard.js` splits the reads in two. Categories and baker names are
fetched **once** — they don't change during an episode, and it keeps
`v_baker_stats`, a view of twelve correlated subqueries, out of a four-second
loop. Everything else is the poll, in two waves, because `v_episode_scores` and
`v_public_predictions` carry no `league_id` and have to be filtered by the
player ids only `v_standings` can supply. **That filter is load-bearing, not
tidiness:** seasons are shared across leagues by design, so both views hold rows
for every league running the series, and dropping it would put a stranger's
picks on this league's wall.

**`league_id` on `v_episode_scores` was considered and not done.** The note that
used to live here assumed it would save a round trip. It doesn't: the wall also
needs an `episode_id`, and episodes need the `season_id` off the league, so the
page is a two-wave chain either way. What it would buy is one poll becoming a
single parallel batch — about 200ms inside a 4s interval, in exchange for a
permission-boundary edit and a smoke-test paste. Worth revisiting only if
something else wants it.

**League resolution:** an explicit `/league/<slug>`, then the league belonging
to the code in `localStorage`, then `is_default`. Resolving a code to a league
needs `/api/player`, so `/play` now caches the answer: `fbo.who` holds
`{ playerId, leagueSlug }`, written on every successful `state` call. Both are
public facts — `v_players_public` publishes every id, name and colour — and the
code stays in its own key. A browser that logged in before this existed spends
**one** invocation on its first dashboard load and caches the result; it never
happens on a poll. Looking at somebody else's league says so quietly, with a
link back to your own.

**`pickCurrent` is now in two places.** `src/lib/dashboard.js` has its own copy
of "the lowest-numbered episode not yet complete", and of `categoriesFor`,
because `src/` cannot import `api/_episodes.js` — that pulls in `_supabase.js`
and the service-role key with it. Both files carry a comment naming the other.
**Change one, change the other**, or `/play` and `/` will be on different weeks.

### The chart

Hand-rolled SVG, no library. The constraint it is built around is that only four
series hues are validated and there are sixteen identity colours, so it has to
work with a dozen lines that cannot be told apart by hue:

- **Three states per line** — full, muted at 25%, hidden — cycled by tapping a
  leaderboard row or a legend chip. Everyone starts muted bar the top three and
  you, and that default is set once from the first table that arrives and then
  left alone. It is a starting point, not a rule that reasserts itself over the
  reader every time the table reshuffles.
- **Direct labels are drawn in ink with a short dash of the player's colour**,
  not in the colour itself. Aqua is 2.82:1 on white, which carries a 2.5px line
  and fails a 12px word. The dash carries the hue, the ink carries the name.
- **A plain table of the same numbers** behind a toggle. Not optional.
- Colour follows the player from `colour_hex`, never their rank.
- Crosshair and tooltip on **mouse only**: on a phone a pointer handler here
  would fight the sideways scroll, and touch has the rows and chips instead.

**Series bonuses are not on the lines.** `v_series_bonus` carries no episode, so
there is no honest week to attach a +3 to — the same reason `movementFor`
carries them across rather than counting them as this week's news. The
leaderboard total includes them and the chart says so when they are non-zero.
It is theoretical until phase 6 puts top-three picks in.

### The leaderboard, and the reorder

Rows are buttons, because a row is also the chart's control. The 300ms position
transition DESIGN §10 asks for is FLIP: after React reorders the rows, each one
that moved is translated back to where it was and released, so CSS carries it
home. It measures `offsetTop` and **not** `getBoundingClientRect().top` — the
second is viewport-relative, so scrolling the page between two polls would look
exactly like every row moving at once and the whole table would slide.

### The wall

A table: avatar, name, the week's points, then a column per category. Cards per
player were built first and replaced — a table scales to sixteen players, and
reading *down* a column ("everyone said Priya") is what people actually do with
a prediction wall.

Seven columns will not fit a phone at a size where a baker's name is readable,
so it is sized for readability and scrolls sideways with **only the avatar
pinned** — about 2.4rem, so most of the width is data. The disc's colour and
initial identify the row once the name has gone. That makes it the second
element allowed to scroll sideways where DESIGN §6 reserved that for the chart;
§6 is the section marked as sketched until there was real data in it.

**It marks wrong picks as well as right ones, unlike the scorecard on `/play`.**
There, prose carries it and a wrong pick recedes because it costs nothing. A
wall cell is a name in a box with no room for a sentence, so the tint would be
carrying the meaning alone. `src/components/Mark.jsx` is the shared mark and its
header explains the split.

**The wall is empty right now and that is the system working.** No episode has a
deadline, and `v_public_predictions` fails closed on exactly that. The panel
says which of the two reasons applies rather than showing a blank.

### What phase 5 does not cover

- **Top Three board.** Deferred to phase 6, and it is not merely a cost
  question: `top_picks` is ungranted and **no granted view exposes who is in
  whose three** — `v_series_bonus` carries points only, `v_baker_stats` a count
  per baker. It needs a new view as well as the `saveTopPicks` API and UI.
- **Stats strip** — phase 6, as planned.
- **The results grid names the winner rather than showing their face.** There
  are no photos, and `v_episode_results_public` carries `baker_name` and not
  `photo_url`.
- **The recap is collapsed on every screen**, not just phones. One tap, and it
  is the least live thing on the page.

**Leagues** — later; one league is enough for now.

---

## Gotchas that cost time here

**There IS a browser: headless Chrome works.** Elena has looked at `/play` and
at the GM panel's Live and Episodes tabs. **The Entries, Players and Bakers tabs
have still never been seen by anyone** — they are checked against the database,
not against a pair of eyes.

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new \
  --disable-gpu --hide-scrollbars --user-data-dir=<a scratch dir> \
  --virtual-time-budget=5000 --screenshot=<absolute path> \
  --window-size=420,1200 http://localhost:5178/play
```

Three things that cost time getting that to work:

- **Chrome will not open a window narrower than ~512 CSS px on this machine.**
  Ask for 390 and it lays the page out at 512 and screenshots the leftmost 390 —
  which looks *exactly* like a page overflowing its viewport, and sent me
  hunting a CSS bug that did not exist. `--force-device-scale-factor` does not
  help; it doesn't change the layout viewport. To judge a phone, impose the
  width on the content instead (a 390px wrapper) and shoot a wider window.
- **Use `--headless=new`, an absolute `--screenshot` path and a scratch
  `--user-data-dir`.** Old `--headless` crops instead of resizing; a relative
  path silently fails with "Access is denied".
- **Measure before believing a layout is broken.** One `getBoundingClientRect`
  sweep printed into the page settled in one shot what guessing at CSS did not.

**An eliminated baker disappears from `/play`'s pickers immediately**, and
`savePicks` refuses one (`status=in.(active,finalist,winner)`). Since the
leaving result now marks bakers out as it is entered, that lands mid-episode.
It only reaches a VERY LATE player the GM has unlocked: they cannot save a pick
naming whoever just went. Accepted — they can already see the results anyway.

**An agent session cannot run `smoke_test.sql`.** PostgREST does not execute
arbitrary SQL, and the database password isn't among the three environment
variables, so that file needs a human in the Supabase SQL editor — which is also
why it needs pasting after every `views.sql` change and cannot be automated
away.

What an agent *can* do, and what was done in phase 4: build the same fixtures
through the REST API under a **throwaway season**, assert against the views, then
delete the season — every foreign key down from `seasons` is
`on delete cascade`, so one delete takes leagues, players, episodes, results,
entries and predictions with it, and nothing real is touched. All 19 of
`smoke_test.sql`'s rules still held on 2026-09-07, after phase 3. Keep that
harness in a scratch directory rather than the repo: `smoke_test.sql` is
canonical and two copies of the same assertions would drift.

The same trick works for `/api/player`: a fixture player in a throwaway league
hung off the **real** season exercises the real episodes, categories and bakers
without touching the real league's standings.

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

**To look at it on a phone**, the dev server needs `--host`: by default it binds
to `::1` only, so nothing else on the network can reach it. Then
`http://<this machine's LAN IP>:<port>/`. Windows Firewall may prompt on the
first connection, and a live VPN can capture the LAN route. `/api/*` works there
too — `vite.config.js` serves it in dev.

**React's compiler reads any `.current` property as a ref access** and gives up
on memoising the component that touches one, which surfaces as a
`preserve-manual-memoization` lint error rather than anything about refs. That
is why `fetchLive` returns `currentEpisode` and not `current`. Similarly,
writing to a DOM node reached through a ref that arrived as a *hook argument*
trips `react-hooks/immutability` — the FLIP hook in `Leaderboard.jsx` owns its
ref and hands it back for that reason.

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
  DESIGN.md §6 builds the three-state line model around it, and phase 5
  implements it: direct labels, the muted default, and the numbers table are
  what carry a dozen players, not the hues.
- **The prediction wall scrolls sideways**, which DESIGN §6 reserves for the
  chart. Seven columns do not fit a phone at a size where a baker's name can be
  read. Only the avatar is pinned. §6 is the section marked as sketched until
  there was real data in it — worth a decision when that section is rewritten.
- **The wall's pinned column uses `position: sticky` on table cells** with
  collapsed borders. Current Chrome and Safari handle it; anywhere that doesn't,
  the column simply scrolls with the rest — readable, just not pinned.
- **The identity palette (16 colours) has not been validated.** It doesn't need
  the chart's gate because those colours always sit beside a name, but it's owed
  a pass.
- **`is_gm` is a display flag**, not authorisation. The GM panel is gated by the
  password alone.

- **DESIGN §4's `--live` reservation is out of date.** It says the red is
  reserved for "the episode is airing" and LATE / VERY LATE. Since phase 4 it
  also marks a **penalty** on the player panel — decided deliberately (see
  above), but the document hasn't caught up. Elena owns DESIGN.md; suggested
  wording is in the phase 4 notes. §7's hatching paragraph is still accurate,
  though the stripe is now the ink at 18% alpha rather than `--line`.
