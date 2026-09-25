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

The series has **ten episodes**, weekly on Tuesdays: **22 September to 24
November 2026**. **The league is live** — episode 1 has aired, been marked
complete, and scored. Changes now land in front of real players; the deadline
and the air time are the times to avoid deploying.

---

## Where it is now

| Phase | State |
|---|---|
| **0 — scaffold** | ✅ Done, deployed |
| **1 — schema, views, RLS, seed** | ✅ Done, applied to the live database, smoke test passes |
| **2 — player panel** | ✅ Done, verified end to end by Elena logging in and making picks |
| **3 — GM panel** | ✅ **Done.** All six tabs, every one of them looked at in a browser by Elena. |
| **4 — scoring wired into `/play`** | ✅ **Done.** SQL applied, smoke test passing, and seen in a browser with real results entered from the GM panel. |
| **5 — dashboard** | ✅ **Done.** Chart, leaderboard, results grid, prediction wall and the series recap. No SQL changes. Looked at on a phone. |
| 6 — `/bakers`, `/rules`, top-three picks, stats | ✅ **Done.** All four: `/bakers`, the top three (picker on `/play`, board on `/`), the stats strip and `/rules`. SQL applied and the smoke test passes. |
| 7 — avatar builder, visual polish | ⬜ Not started, but **the spec and the art brief are written** — DESIGN §11, [ASSETS.md](ASSETS.md), `src/avatar/TEMPLATE.svg` |
| 8 — the bake guess | ✅ **Done.** Two bakes per player before episode 1, ticked weekly by the GM, scored 5/2/0 in SQL. **Two new tables**, so `schema.sql` is pasted first this time — see below and TECH_PLAN §14 |
| 9 — the deadline penalty | ✅ **Done.** Missing the deadline costs −2 (RULES §2.5), and the reveal moved from the deadline to the broadcast so a latecomer still guesses blind. `schema.sql` → `views.sql` → `rls.sql` applied, smoke test passing. Confirm became a real lock on your own picks |
| — multiple leagues, GM half | ✅ **Done**, outside the phase numbering. The Leagues tab, `upsertLeague`, and league scoping on Entries and Players. **No SQL, no new grant, nothing to paste.** The dashboard switcher is built too — a button per league at the foot of the page, scoped to the season so the demo leagues stay off it |
| — the wall before the reveal | ✅ **Done**, outside the phase numbering. The sealed wall was a paragraph saying the picks were hidden; it is now the whole roster with the contents withheld — who is in, how far, who is late, who has confirmed — so it answers *who still hasn't done theirs?* **No SQL, no new grant, nothing to paste**: `picks_made` and `confirmed` were already on `v_episode_scores`, which is granted and ungated. A count is not a pick |
| — the bonus gets a week, and the dashboard a key | ✅ **Done**, outside the phase numbering. The top-three bonus now lands on the semi-final (+3 each) and the final (+6), which is what RULES §5 always said and nothing implemented — so the chart and the leaderboard agree again, and the bonus moves the table on the night. `views.sql` → `rls.sql` applied, smoke test passing. **No new grant.** Plus a shut-by-default "How to read this" at the foot of six dashboard panels, and the word *holding* removed from the leaderboard and the scorecard |

Live database state, as of **2026-09-25** (read through the public views):

- **One season, three leagues** on it: **Sussex Oven** (`sussex-oven`, the
  default, 15 players), **Jammiest** (`jammiest`) and **ACRG-bakes**
  (`acrg-bakes`). The switcher at the foot of `/` shows all three.
- **All ten episodes have dates**: 18:00 deadline, 20:00 air, UK time — stored
  as 17:00/19:00 UTC through episode 5 and 18:00/20:00 UTC once the clocks go
  back, which is the trigger doing its job, not a typo.
- **Episode 1 is `complete`**, with points on the table. Episode 2 is current:
  deadline Tue 29 Sep. So `/` is in the `pickShown` window right now — two
  results boxes, the week column on episode 1 (phase 5 below).
- The real 12-baker cast. The two demo seasons and the fictional phase 3/4 test
  results are **gone** — the public views see one season and none of the old
  test winners.

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
where ep.live_at is not null    -- fails closed: no air time set = not public
  and ep.live_at <= now();
```

That is the whole of "nobody sees your picks before the episode airs". Episodes
are seeded with a null date, so failing closed is not theoretical.

**That line appears three times, on three different clocks.**

| View | Gate | Protects |
|---|---|---|
| `v_public_predictions` | the episode's own `live_at` | this week's picks |
| `v_top_picks_public` | **episode 2's** `live_at` | whose three is whose |
| `v_series_guesses_public` | **episode 1's** `live_at` | everyone's bake guesses |

`v_top_picks_public` carries the same clause against episode 2 because RULES §5
reveals everyone's top three at the start of episode 2. Anything reading
`top_picks` goes through that view, `v_baker_stats.in_top_threes` included;
reading the base table is how the count leaked before phase 6 fixed it.

There is a **fourth** copy of the rule that is not a view:
`api/gm.js`'s `picksPublic` and `buildGuesses`'s `visible`. The GM is a player,
so the panel is held to the same clock as everybody else (RULES §8). Those two
lines must move whenever the views do — miss them and the one person entering
results gets a private two-hour look at everyone's card.

**THE GATE IS THE REVEAL, NOT THE LOCK, AND THOSE ARE NOW DIFFERENT MOMENTS.**
18:00 closes the picks and prices lateness at −2; 20:00 airs the episode, locks
the panel and publishes everything. They were one instant until the −2 landed,
and splitting them is what makes the penalty safe: if picks went public at the
deadline, a LATE entry would be written with the whole league's card on screen,
which is worth far more than 2 points is a deterrent. Now **however late you
are, you are guessing blind** — structurally, not by warning. The only exception
is VERY LATE, which arrives after the reveal by definition, and which only the
GM can allow.

The lock still lives on `deadline_at`, in `api/player.js`. **Do not let the two
drift back together**: `buildGuesses` in `api/gm.js` deliberately reads
`live_at` for `visible` and `deadline_at` for `locksAt`, and the smoke test
toggles them separately for the same reason.

Each moment is **derived from `air_date`** through `schema.sql`'s trigger — so
there is no second date to keep in step and nothing a GM has to remember.

That last part is not decorative, and its history inverts, which is worth
knowing before anybody "fixes" the gate back. `v_series_guesses_public` gated on
`live_at` once before and it was wrong **then**: `live_at` was stamped by a **Go
live** button and cleared by **Take it back**, and Take it back was the only
route from `live` to `complete`. So every episode reached "over" with a null
`live_at` and the guess board emptied exactly when the episode finished. **A
gate hanging off a button somebody has to remember to press is not a gate.**

That finding is what killed the button — and killing it is what made `live_at`
safe to gate on. It is now derived at 20:00 exactly as the deadline is derived
at 18:00, no button touches either, and the reveal has moved back onto it
deliberately. The smoke test asserts the gate opens via an **air date** and the
trigger, never by setting `live_at` by hand, so the property is pinned rather
than assumed.

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
  _guesses.js     normaliseGuess — the canonical form of a bake guess. Shared,
                  because both endpoints write guess_key. Case and whitespace
                  ONLY: it never stems "madeleines" to "madeleine", because
                  that decision is worth 3 points and belongs to the GM.
  player.js       login · state · savePicks · saveTopPicks · confirm.
                  Lateness + lock rules — and saveTopPicks runs the SAME ones
                  against episode 2, via the same lockState call. savePicks
                  carries the bake guesses too, against episode 1, for the
                  same reason: one ladder, not two.
  gm.js           state · setCategory · setEpisode · toggleDisallow ·
                  unlockEntry · upsertLeague · upsertPlayer · generateCode ·
                  upsertBaker · setGuess · setGuessHit. Password every call.
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
    stats.js      the stats strip's five numbers. Counts rows SQL already
                  decided; NO scoring rule lives here. Header says why.
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
    ResultsGrid.jsx  this week, in three states that must not look alike; drawn
                     twice until the next deadline (`last`, pickShown)
    PredictionWall.jsx  everyone's picks, sealed until the episode AIRS. Until
                        then it is the same roster with the contents withheld —
                        who is in, who still has nothing. A count, never a pick
    TopThreeBoard.jsx   everyone's three — empty until EPISODE 2's deadline,
                        same reason, same shape
    GuessBoard.jsx      everyone's two bakes — empty until EPISODE 1 goes
                        LIVE. Shares .th-board-* with the board above, because
                        they are the same shape of thing and read as a pair
    StatsStrip.jsx   five things worth knowing; open by default
    SeriesRecap.jsx  every week so far, collapsed
    HowToRead.jsx    the "How to read this" key at the foot of six dashboard
                     panels, SHUT by default. A key for marks a panel has no
                     room to spell out in place — never where a fact first
                     appears, or the panel stops reading correctly for the
                     people who never open one
  pages/          Dashboard · Play · Bakers · Rules · Gm
    gm/           one file per GM tab; Gm.jsx is only the shell
      GuessesTab.jsx  the bake guesses, grouped by canonical wording with the
                      holders under each. Reword, strike out, and one tick
                      per guess. A SEASON tab, despite being full of people
      leagueScope.js  which league Entries and Players are showing, and the
                      grouping. Says WHY Live/Episodes/Bakers/Guesses get no
                      picker
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

**Episodes** — theme, air date, the two derived moments, bingo prompt, status.

⚠️ **There is no Go live button, and that is deliberate.** The panel locks
itself at **20:00 on the air date** (`live_at`, derived by the same trigger that
sets the 18:00 deadline). The button was removed because RULES §2.5's promise —
*"the panel locks when the episode starts"* — rested entirely on the GM
remembering to press something, live, while watching television. Forget it and
the panel never locks: someone can submit at 21:15 having watched the technical
and be flagged only LATE, with nothing anywhere saying so. The same forgotten
tap also left the dashboard polling at 30s through the one hour the 4s interval
exists for.

Both moments are **editable per episode** for a week that airs at an odd hour —
"Take it back" became "move the time". And `status` lost its `live` value:
whether an episode is on air is `live_at <= now()`, computed in
`v_episodes_public.is_live` for the browser and from `serverNow` in the panel.
**Only `complete` does anything** — it is what moves everyone on to next week.

**Entries** — the roster for this episode: who has submitted, how late, the
**Disallow** checkbox and **Open the door**. It lists *players*, not entries,
because the person who needs a door opened is usually the person who has not
submitted at all.

**Players** — add someone, rename them, recolour them, reissue a lost code.
Codes are shown in full; this is the screen you come to when one goes missing.

**Bakers** — rename the placeholders when the cast lands, mark eliminations, set
`finalist` / `winner` at the end.

**Leagues** — add a league (a name and a link), see how many players each has,
move the default, archive and bring back. Last in the bar: it is touched when a
league starts and then not again.

### Two kinds of tab, and the panel says which

This is the thing to understand before adding anything to the panel:

| About the **season** — one answer for everyone | About a **league** |
|---|---|
| Live · Episodes · Bakers | Entries · Players |

Results, episodes, deadlines and the cast hang off the season and are shared by
every league playing it, so **you type each result once no matter how many
leagues are running**. Only Entries and Players are about who is playing, and
those two alone carry a **league picker** under the episode one — deliberately,
because a selector above the Live tab would imply that entering Star Baker
affects one league and not the others. Episode night is the wrong moment to
install that idea.

The picker shows even with a single league. Gating it on `leagues.length > 1`
was the first version and it was wrong twice over: a control nobody has seen
turns up on the evening it first matters, and "which of these tabs is about a
league?" becomes something you have to know rather than read. The same mistake
hid the Archive button — see below.

With several leagues, both tabs **group their rosters under league names** and
each Entries group carries its own *"3 of 8 in"*; one count across every league
is a number about nobody. The league is not repeated on each row, because the
heading carries it when several are in view and the picker does when one is.

**The filtering is in the browser, in `src/pages/gm/leagueScope.js`, not in
`api/gm.js`.** `buildState` already returns every player in the season, the
panel does not poll, and a server-side scope would mean every write action
carrying the right `leagueId` or silently answering with somebody else's roster.
Worth revisiting only if a league gets big enough for the payload to matter.

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
- **The GM sees pick counts, not picks, until the episode airs.** Elena plays as
  well as runs it, so the Entries data carries `picks_made` and withholds
  `picks` until `live_at` has passed — the same rule as `v_public_predictions`,
  applied at the other end of the wire, and it moved with that view in phase 9.
  Weekly picks stay on the reveal deliberately, unlike the bake guesses: there is
  no editing job to do in the 18:00–20:00 gap, so there is no reason to look.
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
- **`upsertLeague` normalises slugs rather than validating them.** "The Proving
  Drawer" becomes `the-proving-drawer`, and a typed slug goes through the same
  funnel. The result must match `src/App.jsx`'s `/league/<slug>` pattern, or the
  league exists with no way to link to it — which you would find out only after
  sending the link round. Slug uniqueness is **global**, not per season: a URL
  carries no season with it.
- **The default league can be moved but never switched off, and never
  archived.** It is what someone opening `/` with no code sees. Moving it is
  clear-then-set, because `leagues_one_default_per_season` permits exactly one —
  the other order is rejected by the index outright, and this one fails towards
  a moment with no default rather than a moment with two. The first league in a
  season takes the flag automatically.
- **Archiving is a display change, not a lock.** `v_leagues_public` carries
  `where is_active`, so an archived league drops off the dashboard while its
  data stays put — but `api/player.js` finds a player by their code alone, with
  no `is_active` check, so its players can still sign in at `/play` and submit.
  Archive last year's league; do not archive one to shut somebody out. Whether
  it *should* lock them out is open — TECH_PLAN's Still-open table, #9.
- **Two controls are disabled with a reason rather than hidden**, and both were
  hidden first: **Archive** on the default league, and the league picker with
  only one league. A control that is simply absent reads as a missing feature,
  and in both cases the ordinary one-league setup was exactly the case that hid
  it — so nobody would ever have seen either. Refusals are worth saying.

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
row and prints a sentence.

**This section used to end "if a third penalty is ever added, the panel needs one
new string in `penaltyWording` and nothing else."** A third penalty was added —
the deadline −2 of RULES §2.5 — and that turned out to be true only for a
penalty that belongs to a *pick*. This one belongs to the **week**, so it carries
a null `category`, no `Verdict` ever matches it, and it needed a home of its own:
the sums block at the foot of the scorecard, which is now itemised per penalty
rather than showing one total. The null is load-bearing in both directions — it
is what keeps the −2 off an innocent pick cell, and what the sums block uses to
label it.

**Movement is the one real derivation.** `v_standings` knows only where you
stand now, so last week's table is rebuilt from `v_episode_scores` — points from
the episodes before this one, re-ranked with the same tie-and-skip rule Postgres
uses. Week one reports no movement at all rather than telling everybody below the
leader they have fallen.

**The series bonus used to be added on top of that and no longer is.** It had no
episode, so `movementFor` carried it into both tables, where it cancelled out and
could never move anybody — which is exactly what RULES §5 promises it should do.
It now lands on the semi-final and the final like any other points
(`v_series_bonus_scores`), so it arrives inside the per-episode rows and moves
the table on the week it is won. **Adding `bonus_points` back here would count it
twice and quietly cancel the movement out again.**

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
don't mark it `complete` yet — but that also keeps next week's picks shut. The
dashboard holds a finished week until the next deadline anyway (`pickShown`,
phase 5 below), so `/play` is the only screen this still costs.

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

**Series bonuses ARE on the lines**, and this section said the opposite until
the fix below. They had no episode, so the lines summed episode points while the
leaderboard added the bonus on top: from the semi-final onwards the chart and
the table disagreed by up to 15 points, with nothing on the page able to account
for the gap. `v_series_bonus_scores` now lands the +3s on the semi-final and the
+6 on the final, which is what RULES §5 always said — so the chart needs no
special case and the two agree at every point in the series. Nothing shows until
bakers are marked `finalist` after the semi-final.

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

**Before the episode airs it shows the same roster with the contents withheld** —
`SealedWall`, in the same file. Every player is a row, submitted or not: one with
picks in gets a solid band of icing and a `4/5`, one with nothing gets the dashed
stitch border and *Nothing in yet*. The panel used to be a paragraph saying the
picks were hidden, which was true and answered nobody's actual question on a
Tuesday afternoon — *who still hasn't done theirs?*

Showing **only the people who are in** was the other option and is the weaker
one: it makes "missing" an absence, and an absence is something you have to know
the roster to notice. A gap in a column is something you can see.

**It needed no SQL and no new grant**, which is the part worth not re-deriving.
`v_episode_scores` is granted with no gate of its own and its spine is every live
entry, so `picks_made` has been a public fact since phase 4 — the same one the
GM's Entries tab shows as "3 of 8 in", at the other end of the wire. **A count is
not a pick.** *Which* categories somebody has filled in is published nowhere, and
publishing it means a column on that view, a smoke-test assertion and a paste. It
buys "Sam skipped the bingo", and that is not worth a permission-boundary edit.

Three details that fall out of the data rather than being decided:

- The test is **`picks_made > 0`, not "has an entry row"**, so an empty saved card
  reads as nothing in — which is RULES §2.5's own rule, arrived at without this
  having to know it. A disallowed entry drops out of `v_episode_scores` and reads
  the same way, which is also what that rule says.
- **Lateness and `confirmed` ride on the same view**, so the 18:00–20:00 window
  names its latecomers here as well as on the revealed wall, and the −2 lands in
  the count column the moment it is owed.
- **The band is icing, not grey**, deliberately: grey is the revealed wall's
  *wrong* pick (DESIGN §7). Blank reuses `.pending` — the same mark and the same
  meaning as a result still to come.

**When you see it at all is decided by `pickWall`**: from two days before the
deadline until the episode airs, plus the whole run-up to episode 1. The rest of
the week the slot holds last week's revealed wall, which is the right trade — a
table of blanks on a Wednesday morning is not news. If it should be up longer or
shorter, the dial is `SEAL_LEAD_MS` (it was one day until 2026-09-25).

**An episode with no air date shows the sealed face, and that is the system
working.** No date means no `live_at`, and `v_public_predictions` fails closed on
exactly that — the sealed face then says which of the two reasons applies
rather than going blank. This was the state of the whole series until the
schedule was entered in September 2026.

**A finished week keeps its wall for a few days** — `pickWall` in
`src/lib/dashboard.js`, added after this phase. Marking an episode complete is
what moves everyone on, and next week's picks are sealed until its own deadline,
so the wall used to go blank for most of a week the moment you finished typing
results — before half the league had looked at it. It now stays up until **two
days before the next deadline**, then hands over to the sealed panel and its
countdown. The band names the episode on every wall (`The wall · Episode 1`) and
a notice above the table says it is last week's; the stats strip's two
pick-based cards follow the same week, since the lone call is a thing you read
*against* the wall. An episode with no deadline of its own has no "two days
before" to count to, so last week's holds until the schedule lands.

**The results grid and the leaderboard's week column hold on too, until the
next deadline itself** — `pickShown`, beside `pickWall`. Between marking a week
complete and the next episode's 18:00 deadline:

- the results grid shows **two boxes**: `Last episode · 1` with its results and
  the Finished pill, then `Episode 2` with blank cells and the new bingo prompt;
- the leaderboard's week column and movement arrows stay on the finished week.
  The column says `+7 in ep 1` rather than "this week", because `/play` is
  already taking episode 2's picks.

At the deadline the Last episode box goes and both move on. The deadline and not
the air time, on purpose: a −2 for lateness can only land after 18:00, on the
new episode's row, so switching then keeps the week column and the total moving
together. The header, the 4s poll and `/play` stay on the real current episode
throughout — `pickCurrent` is untouched, so the two copies of it still agree.

A typical week, episode 1 → 2: GM marks 1 complete → two results boxes, wall and
table still on 1 · two days before ep 2's deadline → sealed ep 2 wall · 18:00
deadline → Last episode box gone, week column on ep 2 · 20:00 → reveal.

These two are the only things on the page that read the **device** clock rather
than the server's, and their headers are explicit about why that is allowed
here: each chooses between two episodes whose data the server has already
published, so a wrong clock shifts the changeover and can never reveal anything
early. Once the next episode's `predictions_public` is true, that wins
regardless for the wall. A `deadline_passed` column on `v_episodes_public` would
take the device out of it, and was turned down as a SQL paste and a smoke test
for a display-only timing.

### What phase 5 does not cover

- **Top Three board.** ✅ Built in phase 6 — see that section below. It needed
  the new `v_top_picks_public`, because `v_series_bonus` carries points only and
  `v_baker_stats` a count per baker, so nothing granted said who was in whose
  three.
- **Stats strip** — phase 6, as planned. Still to do.
- **The results grid names the winner rather than showing their face.** There
  are no photos, and `v_episode_results_public` carries `baker_name` and not
  `photo_url`.
- **The recap is collapsed on every screen**, not just phones. One tap, and it
  is the least live thing on the page.

**Leagues** — the GM half is now built (see the GM panel section above), and the
dashboard has resolved leagues since this phase: `/league/<slug>`, then the
league behind the stored code, then `is_default`. **The switcher is now built
too**: `src/components/LeagueSwitcher.jsx`, under the recap, one button per
league. `resolveLeague` returns the list as `siblings` — the leagues sharing the
season of the one on screen, which is what keeps the demo leagues off it. No
extra query, no SQL. TECH_PLAN §5 and Still-open #8.

---

## Phase 6: `/bakers`

✅ **Built**, and looked at in a browser at both widths.

**No SQL, no endpoint, no new grant.** `v_baker_stats` already published
`photo_url` and `bio_line` and was already granted to the publishable key, and
the GM panel's Bakers tab already had fields for all three. The page reads that
one view and nothing else, so it costs zero Vercel invocations like the rest of
the read-only half of the app.

**It fetches once and does not poll**, per TECH_PLAN §8. `v_baker_stats` is
twelve correlated subqueries and this is the page you open while *deciding*
picks, not while watching them score — the dashboard is the live one. A baker
eliminated mid-episode needs a reload here, which is the trade.

**Everything on zero is left out entirely.** Chips, weeks survived and the wry
line are all conditional, because twelve cards reading "0 weeks in the tent" on
the morning of episode 1 is noise, and TECH_PLAN §5 asks for stats that fill in
as the series runs. Before the first result a card is a face, a name and a line.

**Nothing on this page is driven by what players predicted, deliberately.**
`v_baker_stats` also carries `picked_best`, `picked_leaving` and
`in_top_threes`, and the first version printed the wry one — "written off twice,
still here". Elena had it taken out: `/bakers` is the cast reference you read
while *deciding* your picks, and how the league has voted is a fact about the
players, not about the baker. **Those stats belong in the dashboard's stats
strip**, which is still to build, and where "the most-predicted-to-leave baker
who keeps surviving" is already on the list in TECH_PLAN §5.

Two things fall out of keeping them off, both worth preserving if anyone is
tempted to put them back:

- The page shows only what happened in the tent, so it needs **no deadline
  reasoning of any kind**. Every other surface that touches predictions has to
  care about `deadline_at`; this one does not.
- It sidesteps `in_top_threes` entirely — see the warning below.

Whoever builds the stats strip should know that these counts are **series-wide,
not league-wide**: they come from `v_public_predictions`, which carries rows for
every league playing the season, and `v_baker_stats` has no league filter and
cannot easily get one since it is keyed on the baker. With one league running
they are the same number. Arguably "written off by half the country" is the
better version of the stat anyway, but it should be a decision, not a surprise.

Note **TECH_PLAN §5 still lists the league-flavoured stats under `/bakers`** and
is now out of date on that point. Elena owns that file.

### The cast

[supabase/cast_2026.sql](supabase/cast_2026.sql) renames the twelve placeholders
to the real 2026 cast and gives each a bio line and a photo. **Paste it in the
Supabase editor** — it is the only outstanding step for this page.

It **updates rather than deletes and reinserts, so the ids stay put** and any
picks already made against a placeholder survive (TECH_PLAN open question #2
asks for exactly that). Keyed on `sort_order` rather than the placeholder names,
so it is idempotent: re-run it freely to fix a bio or swap a URL. It touches no
view, no grant and no policy, so nothing needs re-pasting after it and
`smoke_test.sql` is unaffected.

The bio lines are **ours, not the broadcaster's** — one wry line each, in the
register the placeholders were written in, rather than the site's prose. Names,
regions and photos come from
[the cast page](https://thegreatbritishbakeoff.co.uk/meet-the-class-of-2026/).

**The photos are hotlinked** from the broadcaster's CDN. They serve 200 to a
foreign referer today, so it works — but it is somebody else's URL and will
break eventually, on their schedule. `photo_url` is nullable and every card
falls back to a monogram disc, so a dead link degrades to what the page looked
like before the cast landed rather than to a broken image. If they ever do turn
hotlinking off, the fix is to re-host the twelve files.

**The crop is biased upward** (`object-position: 50% 30%`). The press shots are
waist-up, so a centred circular crop frames the middle of an apron and pushes
the face to the top edge — which defeats the one job this page has. 30% was the
value that framed all twelve heads without decapitating the full-length shots.

---

## Phase 6: the top three

✅ **Built and applied** — `views.sql`, `rls.sql` and `smoke_test.sql` were all
re-pasted, and the smoke test passes.

The picker sits on `/play` **below** the weekly predictions, as a once-per-series
item; the board sits on the dashboard below the wall and above the recap.

### One clock, derived, never stored

The whole design turns on one decision. RULES §5 locks the top three at 18:00 on
the Tuesday before episode 2 — **which is episode 2's own deadline, to the
second.** So nothing stores that moment:

- the **lock** is `lockState(episodeTwo, entryForEpisodeTwo, now)` in
  `api/player.js` — the same function the weekly picks use, called with a
  different episode;
- the **reveal** is `v_top_picks_public`'s `where ep.live_at is not null and
  ep.live_at <= now()` on episode 2 — the same fail-closed shape as
  `v_public_predictions`. (It read `deadline_at` until phase 9 split the lock
  from the reveal; the lock above still uses the deadline.)

Both follow `air_date` through `schema.sql`'s trigger for free, and there is no
way for the two ends to disagree about when the three lock.

**`season_settings.top_picks_lock_at` is therefore dead**, and `schema.sql`
carries a loud comment saying so. It was the stored version of that moment: a
second date that could drift from the first, plus a GM control that was never
built to keep them in step. Do not wire it back up.

Consequences worth knowing:

- **The window opens when episode 1 is marked complete** — "after you have seen
  everyone bake once". If the GM never marks it complete, the picker never
  opens, which is the one workflow dependency here.
- **One door-opening covers both.** A VERY LATE player the GM unlocked for
  episode 2 can save their three as well as their weekly picks, and both are
  flagged late. It is one conversation with the GM, not two.
- **Whenever the window is open, episode 2 IS the current episode** — the window
  opens when episode 1 completes and shuts when episode 2 does, and `pickCurrent`
  returns the lowest-numbered episode that is not complete. So the entry
  `buildState` has already fetched is always the right one, and the picker needs
  no second countdown: it says "Locks with this week's picks" instead, because
  two clocks on one screen only invite the question of which one counts.

### `in_top_threes` was leaking, and is fixed

The warning that used to be in this section is resolved. `v_baker_stats` is
granted to anon and its `in_top_threes` counted `top_picks` **directly, with no
gate** — so from the moment picks opened, anyone could read "seven people are
riding on Priya", which is exactly what RULES §5's episode-2 reveal exists to
prevent. It now reads `v_top_picks_public`, so it inherits the gate.

That was the same bug the view's own header comment already warns about for
predictions ("Prediction-derived columns read `v_public_predictions`, NOT
`predictions`") — `in_top_threes` was the one column breaking the rule. The
smoke test now asserts both directions: no leak before episode 2's deadline, and
that the gate genuinely opens afterwards. A gate welded shut would pass a
leak test for entirely the wrong reason.

### Details that were decided rather than fallen into

- **Rank is a slot, not a preference.** RULES §5 says the three are in no
  particular order and nothing scores them differently. `rank` exists so the
  database can hold "exactly three" via `unique (player_id, rank)`.
- **The picker is a set of toggles, not three selects.** Three dropdowns would
  have implied an order that does not exist, and made "you cannot pick the same
  person twice" a rule to explain rather than one the interface makes
  impossible. At three chosen the rest disable rather than silently ignoring a
  fourth tap.
- **`saveTopPicks` replaces rather than upserts.** `top_picks` is unique on both
  `(player_id, rank)` and `(player_id, baker_id)`, so swapping two of your three
  row-by-row collides with a row the same edit is about to move. One request
  states the whole answer, the same shape as `setCategory`.
- **The board greys dead picks, never drops them.** You are stuck with your
  three, and watching them go home is most of the point.
- **`lockState`'s wording is translated.** It speaks about episodes, because
  that is its job; "That episode is over" said to someone looking at a
  series-long commitment is a non-sequitur. `topThreeLockReason` says it in
  terms of the thing on screen. Same rule, same clock, different sentence.
- **The GM cannot disallow a top pick.** `is_disallowed` exists and the scoring
  views filter on it, but nothing sets it and no UI offers it — Elena's call.

### How it was tested

`smoke_test.sql` covers the SQL gate. The API was exercised by a throwaway-season
harness in a scratch directory (the technique below), **35 checks**, all passing
against the live database: the full ladder — shut before episode 1 completes, on
time, LATE past the deadline, shut once episode 2 airs, VERY LATE with the GM's
door open, and shut for good once episode 2 completes — plus rejection of two,
four, duplicate, non-UUID, eliminated and other-season bakers. The season was
deleted afterwards and the deletion verified.

Two throwaway leagues were also built to look at the UI with real-shaped data:
one parked mid-series for the dashboard, one parked at the picking moment for
`/play`. Both hang off their own seasons, so the real league was never touched.
**Delete them before the series starts** if they are still there:
`DEMO — dashboard preview` and `DEMO — picking`, one `delete from seasons`
each — everything cascades.

---

## Phase 6: the stats strip, and `/rules`

✅ **Both built. Neither needed SQL, an endpoint, or a query of its own.**

### The stats strip

Five cards on the dashboard, above the recap:

| | |
|---|---|
| The favourite | who the room is backing for Star Baker this week |
| Written off | the most-predicted-to-leave baker who is still in |
| Lone call | something exactly one person got right |
| Biggest week | the best single episode anyone has had |
| Sharpest eye | best hit rate across the series |

**Bakers first, then players** — Elena's call, and it fixed a real problem: the
two halves answer different questions ("what is the tent doing" and "who among
us can read it"), and interleaved they read as five unrelated facts.

**Open by default**, unlike the recap. TECH_PLAN §5 originally asked for it
collapsed on a phone; it is still a `<details>` so it can be shut, but a stat
nobody opens is a stat nobody has.

**Nothing in `src/lib/stats.js` is a scoring rule**, and the file says so at the
top. Every number is either counted from rows SQL already decided
(`v_episode_scores`'s `points` and `correct_count`, `v_baker_stats`'s
`picked_leaving`) or comes from `verdictFor` — the single derivation the browser
is allowed, shared with the scorecard and the wall. If a stat ever needs to know
what a category is worth or when a penalty fires, it belongs in `views.sql`.

**Every card returns null when it has nothing to say**, and the strip renders
only what came back — so before the first result the whole panel stays away
rather than showing five dashes. Two thresholds are deliberate rather than
incidental: a "favourite" everyone picked differently is not a favourite (needs
two votes), and a hit rate needs a full episode's worth of picks before a
percentage stops being noise.

`picked_leaving` was added to `fetchReference`, not the poll — it can only
change when a deadline passes, which is weekly, and `v_baker_stats` is twelve
correlated subqueries.

### `/rules`

The scannable version of [RULES.md](RULES.md): the points, the penalty, the
deadline ladder, the top three, the weeks that don't behave, the final and fair
play. Static — no fetch, no endpoint, no login, so it works with no network.

**RULES.md remains the long form and the record of decisions.** If the two
disagree, RULES.md is right and the page is stale.

**The points are duplicated from the `categories` table, not read from it.**
That table is config — changing what Star Baker is worth is a row update — so
this page would not follow. Accepted to keep the page network-free; the numbers
have not moved since RULES §2.1, and `v_categories_public` is already granted if
it ever needs to become a fetch.

**The colophon says "unofficial", and that word is load-bearing.** The site it
credits states it is not affiliated with the programme, Channel 4 or Love
Productions — so "official" would be wrong twice over. Earlier drafts of
TECH_PLAN §5 said official; they were wrong, and are now corrected. The wording
and the link are Elena's, because it credits somebody else's game.

---

## Phase 8: the bake guess

✅ **Built.** Elena's idea, worked through on 2026-09-09 and redesigned the same
day. The architecture is [TECH_PLAN §14](TECH_PLAN.md) and the rules are
[RULES.md §6](RULES.md); this is the short version and the reasoning worth not
re-deriving.

⚠️ **This phase adds two TABLES**, which no phase since 1 has done. The paste
order is therefore `schema.sql` → `views.sql` → `rls.sql` → `smoke_test.sql`,
schema first — `views.sql` has nothing to read without it. All four are
idempotent.

**The game.** Once per series, **before episode 1**, everyone names **two bakes**
they think will come up — "madeleine", "croquembouche". Free text, invented by
the player. A guess pays out the week it appears, once: **+5** if you were the
only one who said it, **+2 each** if exactly two of you did, nothing if three or
more did, and nothing if it never comes up. Ten for a perfect pair.

### The first design was per-episode, and it was spoilable

Guessing a bake for *next week* does not work: the teaser and the episode
description between them pretty much say what will be baked. **Timing fixes
that, not a rule** — a teaser can only spoil the next episode, so a commitment
made once for the whole series cannot be spoiled by one. That is why this
borrows the top three's shape.

It locks **before episode 1** where the top three locks after, and the reasons
are opposite: the top three needs you to have watched everyone bake, and this
needs you to have watched nothing. Locking at episode 2 would leave episode 1's
challenges already public — a freebie or a carve-out.

> ⚠️ **Superseded by phase 9**, which split the lock from the reveal and gave the
> window back: the guesses now lock at episode 1's deadline and go public when it
> airs, with the GM reading them at the lock. The paragraph below is the phase 8
> reasoning, kept because its diagnosis of `live_at` is still the reason the
> column had to be fixed before the reveal could sit on it.

**Locked and revealed at episode 1's deadline** — the same instant, and the same
shape as the top three at episode 2's. An earlier version revealed them later,
when episode 1 started airing, to buy the GM a private window for unifying the
wordings; that gated on `live_at` and broke (see the gate table above). Losing
the window costs little, because the board publishes `guess_text` — which
nothing ever edits — so no word changes under anybody. Unifying moves points,
and no points can land until a guess is ticked.

### The GM ticks, and SQL still scores

Each week the GM marks which guesses came up. **That is recording a fact, not
awarding a score** — the same shape as `episode_results`. So despite being
described as "manual", this design needs **no manual-points column**: the tiers
stay in SQL and the smoke test can assert them. An earlier draft of §14 proposed
one; it was dropped, and the §2 boundary holds with no exception at all.

Two things fall out of it:

- **The weekly job shrinks** — a guess pays once, so a hit resolves it and it
  drops off the tick list. Week 1 is ~15 guesses; by week 6 it is a handful.
- **These points have an honest episode.** A guess hits in a specific week, so
  it steps the chart and moves the table on the night. This used to be the thing
  that set guesses apart from the top-three bonus, which carried no episode and
  could do neither; the bonus was given its two weeks afterwards
  (`v_series_bonus_scores`), and **every point in the game now has a week**. If
  something new ever pays points, give it an episode rather than a second arm on
  `v_standings`.

### The one thing to get right

Store **`guess_text`** (what the player typed, never edited) *and*
**`guess_key`** (the GM's canonical version, which scoring counts). Unifying is
scoring-relevant — turning "madeleines" into "madeleine" can move someone from
+5 to +2 — so the wall shows what they wrote, the scoring uses the key, and the
edit is auditable. One column, and it removes a whole class of argument at a
watch-along where the GM is also a player.

### The two open questions, settled — and they had one answer

Elena settled TECH_PLAN Still-open #6 and #7 together: **all three challenges
count, the showstopper by the name it is given; whole bakes only, never
components.** What collapsed them into one rule is that **the challenge titles
are stated explicitly on the programme** — so the title is the record, and a
guess hits when the word is in the announced title.

That is worth preserving because it replaces a judgement ("is a chocolate egg a
bake?") with a question that has exactly one answer per challenge, which matters
when the GM is ruling live while also playing. **No SQL depends on it** — it is
RULES §6 and `/rules`, and nothing else.

### Three decisions taken while building

**`series_guesses.is_disallowed` was added**, which TECH_PLAN §14's column list
did not ask for. The spec said a VERY LATE guess would be handled "by hand";
with no column, by hand meant the SQL editor. It is the same switch `entries`
and `top_picks` carry, the Guesses tab has a **Strike out** button for it, and
it comes out of the **holders count** as well as the payout — a struck guess
still counted towards the tier would silently drop everyone else from +5 to +2,
which is the opposite of "as if it were never made".

**Holders are counted per LEAGUE, not per season.** Seasons are shared by every
league (TECH_PLAN §2), so a season-wide count would let a stranger in another
league turn somebody's +5 into +2. Points belong to a league because the
leaderboard does. Note this is the **opposite** call from Still-open #10, where
the baker stats deliberately count season-wide — those are a stat, these are
points. `smoke_test.sql` asserts it with a second league.

**`v_episode_scores` carries `guess_points` and not the guess.** That view is
granted to anon with no gate of its own, so a `guess_key` column there would be
a second way to read the guesses on a different clock from the gated view's. One
secret, one gate. This is the one place the design departs from the penalties
precedent, where a `penalties` jsonb *does* ride along — penalties are not a
secret. The words reach the dashboard through `v_series_guesses_public` and
reach a player's own panel through `/api/player`, which is authenticated.

### The spine of `v_episode_scores` widened, and that is the subtle bit

It was `entries`, one row per player per episode they entered. A guess pays in
the week it comes up, which may be a week the player made no picks in — so an
entries-only spine had nowhere to put the points and dropped them silently.

It is now `entries UNION the weeks a guess paid in`, and **only a guess that
actually paid** pulls in a row. A guess that came up but was too popular to
score has nothing to deliver, and a 0-point row for somebody who sat that week
out would draw them on the chart for an episode they were never in. One
consequence: `lateness` is now **nullable** on that view. Every reader already
treats it as a flag rather than a value, so null reads as "nothing to flag".

### Smaller things worth knowing

**The guess section leaves `/play` once episode 1 is behind you** — hidden, not
just locked. From episode 2 onwards it was a receipt for something settled weeks
ago, sitting above the picks people actually opened the page for; the dashboard
board tells that story better, with everyone else's beside yours. `guesses.open`
in `api/player.js` is what decides it, and it means "episode 1 is the current
episode", not "there are guesses".

The consequence, and the reason the scorecard gained a line: **a guess pays in
the week it comes up**, which may be a week whose picks all missed. Without it
the big number would disagree with *"0 of 5 picks right"* and nothing on the
page would account for it. `v_episode_scores.guess_points` feeds a **Bake
guess** row into the split that previously only appeared for penalties.

**The guesses save on the same request as the week's picks.** `savePicks`
re-stamps the entry's lateness from the server clock on every call, so a
guess-only request would mark this week's picks LATE for an edit that was never
about them. One submission, one stamp. The side effect: saving guesses with no
picks chosen creates an empty entry, which shows on the Entries tab as "nothing
in" and puts a 0 on the chart for episode 1. Correct, if slightly literal — they
did submit something.

**The GM sees the guesses at the LOCK, the league at the REVEAL** — 18:00 and
20:00 since phase 9, which gives the GM two private hours. Before the lock the
Guesses tab shows a count and not one word, because the GM plays too and has two
of their own to make; same rule as the Entries tab's pick counts, at the same end
of the wire. After it, **unify the wordings before you tick anything** — that
window exists for exactly this, and a tick is when the points start mattering.

This is the one place the GM's clock runs ahead of the league's, and it is worth
knowing why it is allowed. The GM's own two lock at that same instant, so nothing
they read can change what they guessed. The unification power is the thing worth
watching, not the timing, and RULES §6 answers that separately: `guess_text` is
never edited and sits beside the key on the public board, so the change is
auditable after the fact.

**RULES §6's late-guess warning covered LATE as well as VERY LATE while the
reveal sat on the deadline — phase 9 narrowed it back to VERY LATE.** With the
list now public only once episode 1 airs, a LATE guesser is guessing blind like
everybody else and the −2 is the whole of their penalty. Only a VERY LATE one
arrives after the reveal and could pick something nobody has, guaranteeing +5.
`is_disallowed` and the GM's judgement are the answer there, exactly as the
original design intended.

**Re-ticking a guess in a different episode moves it**, rather than erroring or
paying twice. The `(season_id, guess_key)` unique constraint guarantees a guess
pays once; the alternative to moving it is fixing a mis-tap in SQL on the night.

**An orphaned tick is surfaced rather than hidden.** Reword a guess after
ticking it and the hit matches nobody — harmless, since the scoring view
left-joins hits to guesses, but invisible. The Guesses tab lists them under
*"Ticked, but nobody holds it"* with an untick button. There is one in the real
database right now: `eclaire` was ticked while `eclairee` is what is held.

**A guess row's id is not stable across saves.** `savePicks` replaces a player's
guesses rather than updating them — the same delete-then-insert `saveTopPicks`
uses, and for the same reason (unique on both `(player_id, slot)` and
`(player_id, guess_key)`). So `setGuess` answers 404 for an id captured before a
re-save. The panel refetches on every action so it will not normally hold a
stale one, and the window is nearly closed anyway: the GM unifies after the
lock, when nobody can save unless a door is open. If it ever bites, key
`setGuess` on `(player_id, slot)` instead of the id.

**Task names are deliberately not recorded.** Attribution still works — a tick
says madeleine came up in episode 3, so the recap can say who called it — but
the actual challenge names ("Signature: 12 identical madeleines") are not
captured. That is a separate wish for the recap, and nothing here is shaped so
as to prevent adding it later.

---

## Phase 9: the deadline penalty, and splitting the two moments

✅ **Applied to the live database**, smoke test passing. If you are setting this
up again the order is `schema.sql` → `views.sql` → `rls.sql` → `smoke_test.sql`;
all four are idempotent, and `schema.sql` goes first because this phase adds a
column (`entries.first_submitted_at`). `rls.sql` needed no edit — `v_penalties`
stays ungranted and the number travels out through `v_episode_scores`, exactly as
the −1s do.

Missing the deadline now costs **−2** (RULES §2.5). The change is smaller than it
sounds in SQL and larger than it sounds in the rules.

### It is one penalty, not three

`v_penalties` grew two arms, and they are the **exact negation of each other**:

```
late / very_late   an entry, not disallowed, stamped after 18:00, WITH picks
no_entry           everything else: no entry, an empty card, a disallowed one
```

So the fee is charged once per player per week and can never double. The floor
for a week is **−4** (both pick penalties plus this), not −6. If those ever start
summing to −4 on their own, that pairing has come apart.

All three flavours cost the same 2 points on purpose. Equal magnitudes are what
make a late card strictly better than no card: once 18:00 has gone the fee is
owed, so there is nothing further to lose by playing. A ladder of escalating
fines would quietly advise a latecomer not to bother, which is the opposite of
what a league of friends wants.

### Two things the browser must not get wrong

**`category` is NULL on the deadline penalty**, and that is load-bearing in both
directions. `Scorecard.jsx` and `PredictionWall.jsx` find a pick's penalty with
`p.category === c.key`, so a null matches nothing and the −2 can never light up
an innocent pick cell. And `Scorecard`'s sums block uses that same null to know
it is a penalty about the *week*. The sums block is now **itemised per penalty**
rather than showing one `penalty_points` total — a single "Penalties −4" line can
be two unrelated pieces of news, and rolling them together left the reader to
guess which.

**A player with no entry now HAS a row in `v_episode_scores`.** That is the third
arm of the spine, and it reverses a documented decision: a worthless bake guess
still pulls in no row, because 0 for an absentee is noise, but −2 for an absentee
is the news. Two consequences that bit in review:

- `Scorecard`'s "you didn't enter this week" branch keyed off `week` being null
  and now has to key off `picks_made`, or it greets a non-submitter with
  "0 of 0 picks right".
- The spine arm is written against `pens` rather than against `no_entry`
  specifically, so any future penalty is guaranteed a row to be carried by.

### The no_entry arm is the only thing not built on `entries`

It cannot be — the player it charges has no entry row. So it is
`players × episodes`, and `deadline_at is not null and <= now()` is doing heavy
lifting: a season is seeded with ten numbered episodes and no dates, and without
that gate every player would owe 20 points on day one for weeks that have not
happened. It also means a mis-set date un-charges itself when corrected.

**The penalty is computed at read time, so it is retroactive.** Pasting
`views.sql` re-scores every past week whose deadline has passed. That was
expected and accepted here: the test episodes 1 and 2 carry deadlines, so the
dummy accounts that never voted went to −2 the moment it was applied. Setting
the real schedule — a deadline in the future — clears them again, which is the
same self-correcting behaviour a mis-typed date gets.

### `first_submitted_at`

`entries.submitted_at` is overwritten on every save. That was free while LATE was
a label; with 2 points riding on it, the difference between "in at 17:42, edited
at 18:06" and "in at 18:06" is a conversation with the GM. `api/player.js` sets
the new column on insert only, by omitting it from the upsert payload on the edit
path — PostgREST updates exactly the columns the payload names, and there is no
way to say `coalesce(first_submitted_at, excluded...)` over the wire.

It is also what RULES §7's fourth tiebreak should mean; `submitted_at` would
reward never going back to look at your own card.

### "Edit anyway", and why it is not a rule

`api/player.js` re-stamps lateness on **every** save, so an on-time entry edited
at 18:05 becomes a −2. That is correct — they have had longer to think than
everybody else — but saving is deliberate and *changing a select is not*, so one
stray tap used to cost 2 points.

Elena's first instinct was to lock the panel for anyone who had already
submitted, leaving it open for those who hadn't. That was rejected for three
reasons worth recording, because it will come up again:

1. **"Has submitted" has no clean definition.** Any entry row won't do (empty
   rows are a real state). One pick locks someone out mid-card. `confirmed_at` is
   the honest signal but most players never press it.
2. **It breaks the one-ladder invariant.** `lockState` serves the weekly picks,
   the top three and the guesses from one answer; "have they submitted" would
   have to mean something different for each.
3. **It gives `gm_unlocked_at` a second job**, and an 18:30 GM-opened edit is not
   "very late" in any sense the stamp can express.

So the guard lives in `/play` instead: after the deadline, an on-time entry
renders with its selects **disabled** behind an *Edit anyway (−2)* button. Same
protection against the accident, no new server rule, and the one case it does
*not* prevent — deliberately buying a change for 2 points — is not a loophole now
that picks stay hidden until the broadcast.

The three states `/play` can be in after 18:00 are in `DeadlineNotice`:

| | Situation | What it says |
|---|---|---|
| **A** | nothing in yet | you can still submit; it costs 2 points |
| **B** | a card in, on time | editing costs 2 points |
| **C** | already late | the 2 is spent; editing is free until it airs |

C is worth saying out loud: the flat fee means there is nothing left to lose
before the hard lock, and the panel should say so rather than leaving someone to
assume otherwise.

**One bug worth recording, because it will be tempting to re-introduce.** The
first version reset `unlocked` inside the `state.picks` re-sync block. Every
response carries a fresh `picks` object, so *any* round trip — Confirm,
Un-confirm, or just the tab regaining focus — slammed the gate shut on somebody
who had already pressed *Edit anyway*. Elena found it as "Confirm greys out my
choices". Nothing resets it now: `guarded` stops applying the moment the entry is
stamped late, and `frozen` still honours `!editable`, so 20:00 closes the form
regardless.

### Confirm became a real lock

Chasing that bug turned up a better one. `confirmed_at` did **nothing** but set a
flag for two pills — it was in no scoring path at all — while being labelled
*Confirm*, which everybody reasonably read as "lock my card". Elena's assumption
about what the button did was a better design than the button.

So a confirmed entry now has its picks disabled, and Un-confirm is the way back.
That is a **second guard, different in kind** from the deadline one: `guarded` is
the clock's and protects against a −2; `confirmLocked` is the player's own and
protects against a slip. Still no scoring consequence — `confirm` deliberately
does not re-stamp lateness, so both directions stay free at any time, and only a
save can cost anything.

Two composition details that are easy to get wrong:

- **Where both guards are on, *Edit anyway* clears both in one press** — it
  un-confirms as well as opening the form. Making someone hunt for a second
  button to undo a decision they have just made is how a panel gets sworn at.
- **The plain Un-confirm button is hidden while `guarded`** (`showConfirmToggle`).
  Otherwise it is a second door that un-confirms *without* opening the form,
  which just looks broken. Confirming while guarded is still offered: it is free,
  and "I'm done" is a reasonable thing to say about a card you are not editing.

Note what this does **not** touch: the bake guess and the top three have their own
windows and their own "locked in for the series" messaging, and confirming a
week's card does not lock either. Worth revisiting if it ever reads oddly, but
extending a weekly decision over a series-long one would be the more surprising
behaviour.

### What moved with the reveal

See "The three things that matter most" above — the gate on all three public
views moved from `deadline_at` to `live_at`, and `api/gm.js` moved with them.
The smoke test's fixtures now set **both** moments on every episode; setting only
one was harmless when they were the same instant and is a fixture bug now (a
reveal test with a null `live_at` asserts nothing but "fails closed", and a
penalty test with a null `deadline_at` charges nobody).

Two existing assertions had to be rewritten rather than repaired, because they
encoded the old design:

- *"A disallowed entry must not appear in scoring at all, 0 rows"* — it now
  appears, carrying exactly the −2.
- *"The gate must NOT depend on the GM having pressed Go live"* — still true in
  spirit, now asserted the other way round: the test gives episode 1 an **air
  date** and lets the trigger derive `live_at`, proving the gate follows the
  schedule rather than a button.

---

## The bonus gets a week, and the dashboard gets a key

✅ **Done**, outside the phase numbering. `views.sql` → `rls.sql` applied, smoke
test passing. **No schema change and no new grant**, so it is the ordinary
re-paste order.

### The chart was lying, and RULES §5 already said so

RULES §5 has always read *"the +3s are awarded when the semi-final ends and the
finalists are known; the +6 lands at the final"*. **Nothing implemented that
sentence.** `v_series_bonus` carried no episode; `v_standings` added it on top of
the episode totals; the chart sums episode rows. So from the semi-final onwards
the lines and the table disagreed by up to 15 points, and the only thing the page
could do about it was print a sentence apologising for the gap.

This was a **bug against RULES.md, not a design choice** — which is the useful
way to file it, because the docs had quietly converted an unimplemented rule into
a documented limitation, in five places. If a doc explains why something cannot
work, check the rules before believing it.

Two things follow from the fix, and the second is the better one:

- the chart and the leaderboard agree at every point in the series, and the
  chart needs no special case;
- **the bonus moves the table on the night it is won.** Movement is a re-rank of
  episode points, so a bonus outside them could never produce any — the
  shake-up going into the last episode was structurally impossible.

### How the two weeks are found

`v_series_bonus_scores` splits `v_series_bonus` in two. **The final is the
season's highest-numbered episode and the semi-final the one below it, derived
and never stored** — the same rule as the 18:00 deadline, the 20:00 reveal and
the top-three lock. Nothing to set, nothing to drift.

The cost of deriving it: **adding an episode to a running season moves both.**
Correct — a new last episode really is the new final — and `smoke_test.sql` now
asserts it rather than leaving it as a surprise, by adding episode 7 mid-test and
checking the +6 followed. All ten are seeded up front, so it does not arise.

It **splits `v_series_bonus` rather than recounting from `top_picks`**, so the
two cannot disagree about the total: `finalists` and `has_winner` are exactly the
two halves of that view's `points`. A season with one episode has no semi-final
and the +3s fall back onto the final rather than vanishing — losing points is the
one failure mode not worth having.

Downstream, `v_episode_scores` grows a fourth spine arm (the bonus can land in a
week its owner made no picks in — the same hole the guess arm was opened for) and
a `bonus_points` column. **`v_standings` stops adding the bonus a second time,
and so does `movementFor`.** Either one left in place pays every top three twice.

`v_standings.episode_points` and `total_points` are now the same number, and both
names are slightly wrong — `create or replace view` cannot rename or re-order,
and dropping the view cascades to its grants. Nothing in `src/` or `api/` reads
`episode_points`, so the misnomer costs a comment.

### The `::int` cast is load-bearing

`finalists` is a `count(*)`, so `finalists * 3` is **bigint**, and
`sum(bigint)` returns **numeric** in Postgres. That changed
`v_episode_scores.points` from bigint to numeric, and `create or replace view`
refuses a type change outright:

```
ERROR: 42P16: cannot change data type of view column "points"
              from bigint to numeric
```

The other three arms of that view sum plain integers, which is why they come out
bigint and this has to match them. Two related notes for anyone editing these
views live: a partly-applied paste can leave the new view behind with the wrong
column type, so `drop view if exists v_series_bonus_scores;` before re-pasting;
and `rls.sql` deadlocks against an open dashboard tab, because its `alter`/`grant`
statements want an exclusive lock on relations a 4-second poll is reading. Close
the tabs, or `set local lock_timeout = '3s'` so it fails fast instead.

### "How to read this"

A shut-by-default `<details>` at the foot of six dashboard panels
(`src/components/HowToRead.jsx`), sharing the quiet summary style the recap and
the chart's number table already use.

**It is a key, never where a fact first appears.** The panel above has to read
correctly for someone who never opens it, so anything a player needs in order to
avoid *misreading* a panel stays in the panel — the wall's "these are last
week's picks" notice is the model. What belongs in the key is the vocabulary a
panel has no room to spell out in place: the wall's five cell states and its red
−1, the guess chip that came up and paid nothing, the struck top pick, the colour
dash that ties a row to its line, and the fact that **tapping a leaderboard row
works the chart at all** — an interaction that had no visible affordance.

`term` takes a node, so the keys show the real marks rather than describing
them — the wall passes an actual `<Mark>`, drawn by the component that draws the
cells.

### The word *holding* is gone

The leaderboard's movement line said *holding* when you had not moved. It read as
a state being announced rather than as the absence of a move, next to a points
figure that may well have gone up — that line is about **position**, the one
beside it is about points. Standing still now renders nothing, on the leaderboard
and on `/play`'s scorecard both.

**Zero and "week one" therefore look identical** — deliberate, and the one thing
to revisit if it reads badly: both mean "no news about your place".

The scorecard also gained a **"Your top three"** row in its sums block, for the
reason the bake guess is already there: it is the largest single jump in the game
and it arrives in a week whose picks may all have missed.

---

## Gotchas that cost time here

**There IS a browser: headless Chrome works**, and Elena also runs a dev server
of her own and looks at things directly — ask before assuming a screen is
unseen. Every GM tab has now been looked at.

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
the 38 checks behind `api/gm.js` were run, and the 41 behind `upsertLeague`.
Confine writes to a high-numbered episode, restore what you touched, and re-read
to prove it.

**One test cannot be kept off the real data: moving `is_default`.** There is
exactly one default per season, so proving it moves necessarily clears the real
league's flag for a moment. Snapshot every league row first, restore in a
`finally`, and assert the rows back **field by field** rather than trusting the
restore ran — that last assertion is the one that makes the test safe to run
again. Everything else fits in throwaway leagues, which delete cleanly because
they have no players.

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
  friends — codes are cheap to reissue and predictions go public when it airs.
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
