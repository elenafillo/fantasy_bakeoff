# Fantasy Bake Off — Setup & Technical Plan

*Draft v0.2 — your decisions folded in. Companion to [RULES.md](RULES.md).*

---

## 1. Stack

Same shape as [worm-street](../wormstock/worm-street/HANDOFF.md), because it
worked and you already know how to operate it:

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **React + Vite** | Fast, no framework ceremony, deploys as static files |
| Database | **Supabase** (Postgres) — new project, your second free slot | SQL views do the scoring |
| Server logic | **Vercel serverless functions** (`/api/*.js`) | Where the secrets live |
| Hosting | **Vercel** | Free hobby tier, push-to-deploy |
| Charts | Hand-rolled SVG | worm-street's `PriceChart` is a cumulative line chart already — same problem, and it avoids a chart library fighting the design |
| Avatars | Inline SVG, composed from parts | See §7 |

### Why not Airtable again?

Airtable is genuinely good at the GM side and bad at the two things you now want
most: a public display you control the look of, and per-player logins that hide
other people's predictions. Postgres + a few views gives you both, and the
scoring rules become ~40 lines of SQL that can't drift out of sync between the
dashboard and the leaderboard.

---

## 2. The one big architectural idea

**Results are recorded per *series*, not per league.**

Star Baker in episode 3 is the same fact for everyone watching. So bakers,
episodes, bingo prompts and results all hang off a `season`, and leagues just
point at it.

This means: **during the episode you type each result once, and every league's
dashboard updates.** You're starting with one league, but the schema is built for
several from day one, because retrofitting it later means touching every query.

Leagues own only their own players, entries and standings.

**Where this now stands.** The GM side is built — a Leagues tab, and a league
picker over the two tabs that are about a league rather than the season (§5).
The dashboard has resolved leagues since phase 5 (`/league/<slug>`, then the
league behind your stored code, then `is_default`), so people already land on
their own table without being asked which one they are in. **The one piece not
built is a league switcher on the dashboard** — today you swap by knowing the
slug. `resolveLeague` already fetches every league and throws all but two away,
so that costs no extra query when it is wanted.

One league is still all that is running.

---

## 3. Data model

```
seasons ──┬── bakers
          ├── episodes ──── episode_results
          ├── guess_hits            (season + guess_key → the week it came up)
          └── leagues ──┬── players ──┬── entries ──── predictions
                        │             ├── top_picks
                        │             └── series_guesses
                        └── (settings)
```

`guess_hits` hangs off the **season** while `series_guesses` hangs off a
**player**, and they are joined by the canonical guess text rather than by an
id. That is the shape §2 asks for: what came up is one fact for everyone
watching, typed once; who said it is a fact about a league.

### Tables

**`seasons`** — `id, name ("GBBO 2026"), year, episode_count, is_active`

**`bakers`** — `id, season_id, name, photo_url, bio_line, status,
eliminated_episode, sort_order`
`status`: `active | eliminated | finalist | winner`. Drives which names appear in
the pickers, and how the `/bakers` grid sorts.

**`leagues`** — `id, season_id, name, slug, is_default, created_at, is_active`
Exactly one league per season carries `is_default` — that's what an anonymous
visitor sees.

**`players`** — `id, league_id, display_name, code_norm (unique), colour_hex,
avatar_config (jsonb), is_gm, created_at`

- `code_norm` — the two-word login code, normalised (lowercased,
  punctuation-stripped) exactly like worm-street's `normaliseCode()`. Unique
  across *all* leagues, so a code alone identifies both the player and their
  league — no "which league are you in?" step at the door.
- `colour_hex` — assigned when the code is issued, **unique within the league**.
  See §7.
- `avatar_config` — see §7. Empty until the player builds one.

**`episodes`** — `id, season_id, number, theme, air_date, deadline_at, live_at,
bingo_prompt, status`

- `status`: `upcoming | locked | live | complete`
- `deadline_at` — 18:00 UK on the day of the episode. Stored as `timestamptz`,
  so British Summer Time is Postgres's problem, not ours.
- `live_at` — stamped when the GM opens live scoring. **This is the hard lock**
  and the boundary between LATE and VERY LATE.

**`entries`** — `id, player_id, episode_id, submitted_at, confirmed_at,
lateness, is_disallowed, gm_unlocked_at`

One row per player per episode. This is where all the entry-level state lives:

- `lateness`: `on_time | late | very_late`, computed **server-side** from
  `submitted_at` against `deadline_at` / `live_at`. The client's clock is never
  trusted.
- `gm_unlocked_at` — set when the GM opens the door for this player, this week
  (RULES §2.5). Non-null is the only way to write after `live_at`.
- `is_disallowed` — the GM's switch. Excludes the entry from scoring *and* stats.

**`predictions`** — `id, entry_id, category, baker_id, updated_at`
Up to five rows per entry, one per category.

**`top_picks`** — `id, player_id, baker_id, rank, submitted_at, is_late,
is_disallowed`
Three rows per player, for the series. Unique on `(player_id, rank)` and on
`(player_id, baker_id)`, so "exactly three, all different" is the database's
problem and not the UI's. `rank` is a slot, **not** a preference — RULES §5 says
the three are in no particular order and nothing scores them differently.
`is_disallowed` is carried by the scoring views but nothing sets it: the GM has
no need to disallow a top three, and the column stays for symmetry with
`entries`.

**`series_guesses`** — `id, player_id, slot (1-2), guess_text, guess_key,
submitted_at, is_late, is_disallowed`
Two rows per player, for the series (RULES §6). Unique on `(player_id, slot)`
and on `(player_id, guess_key)`. **Two columns for one answer:** `guess_text` is
what the player typed and is never edited by anyone; `guess_key` is the GM's
canonical form and is what scoring counts. Unifying them is scoring-relevant —
"madeleines" becoming "madeleine" can move somebody from +5 to +2 — so the
original stays on screen beside it and the edit is auditable.

**`guess_hits`** — `id, season_id, guess_key, episode_id, entered_at`
One row per guess that came up, keyed on the canonical form so one tick covers
every player holding it. Unique on `(season_id, guess_key)`: **a guess pays
once**, and that constraint is the whole of the rule. `season_id` is
denormalised from the episode because the constraint needs the season as its
scope.

**`season_settings`** — `season_id, top_picks_lock_at`
⚠️ **`top_picks_lock_at` is dead.** It stored the moment the top three lock,
which RULES §5 defines as episode 2's own deadline — so it was a second date
that could disagree with the first, plus a GM control to keep them in step. Both
the lock (`api/player.js`) and the reveal (`v_top_picks_public`) now derive from
episode 2, which follows `air_date` through the deadline trigger for free. Left
in place, but do not wire it back up.

**`categories`** — `key, label, points, sort_order, applies_to`
A config table, not code: `best (+4), leaving (+3), technical (+2), bingo (+2),
handshake (+2), winner (+5)`. Changing what Star Baker is worth is a row update,
not a deploy.

**`episode_results`** — `id, episode_id, category, baker_id, voided, entered_at`
`voided` is what the UI calls **Nobody**: a row with no baker, meaning the
category happened to no one and pays no one. A category the GM hasn't reached
yet has no row at all — a different state, shown differently.
**Several rows per category are legal and expected** — two bakers going home, two
handshakes, a bingo event that hits three people.

### One row per prediction, not one per week

`predictions` is **tall** — one row per category — rather than a wide table with
five baker columns. This is the decision everything else leans on:

- Scoring is a single join: `predictions ⋈ episode_results` on
  `(episode_id, category)`, times `categories.points`.
- **Multiple correct answers fall out for free.** Two `leaving` result rows, or
  three `bingo` ones, and naming any of them matches — wrapped in `DISTINCT` so
  you score **once**, not once per matching baker. That's RULES §3 implemented by
  the shape of the table rather than by special cases.
- **Nobody** is one boolean on one row.
- Adding a sixth category one series is a data change, not a migration.

The cost is that "show me my week" needs a small pivot in the UI. Cheap.

### The scoring views

```sql
v_prediction_scores  -- one row per prediction, with points won
v_penalties          -- the two −1s, each tagged with the CATEGORY whose pick
                     --   brought it on, so the panel can say which
v_episode_scores     -- player × episode → points, incl. penalties, plus a
                     --   `penalties` jsonb array itemising them by category
v_standings          -- player → cumulative points, rank
v_series_bonus       -- top-3 finalist + winner bonuses
v_baker_stats        -- per baker: star bakers, technicals, handshakes,
                     --   weeks survived, how often picked, how often
                     --   predicted to leave and didn't  (feeds /bakers)

v_episode_results_public
                     -- what happened: category → winner(s), or Nobody.
                     --   Keeps "no row = not decided yet" apart from
                     --   "voided row = Nobody won it", which is the one
                     --   distinction the UI must not collapse. No deadline
                     --   gate: a result is a fact about the episode.

v_guess_scores       -- per player per bake guess: how many in their LEAGUE
                     --   hold it, the episode it came up in, and 5/2/0.
                     --   Feeds v_episode_scores' guess_points. NOT granted.
v_series_guesses_public
                     -- everyone's two, gated on episode 1's deadline
```

`v_standings` gives the current position only. **Movement** — where you stood
last week — is rebuilt in the browser from `v_episode_scores`, since neither
that view nor `v_series_bonus` carries a rank of its own
([src/lib/scores.js](src/lib/scores.js)). That is the only scoring arithmetic
anywhere in `src/`, and it is about ordering, not points.

**Three of these views are deliberately ungranted** — `v_prediction_scores`,
`v_penalties` and `v_guess_scores`. The first two are internal steps computed
from `entries` with no deadline filter of their own, safe only because the views
built on them aggregate the individual picks away. Anything the UI needs from
them travels out through `v_episode_scores` instead, which is why the penalty
reasons are aggregated into a column there rather than the browser reading
`v_penalties` directly.

`v_guess_scores` is the starker case: it names the guesser beside the guess with
no gate at all, so granting it would publish everyone's guesses from the moment
they were typed. `v_episode_scores` takes a **number** from it and nothing else,
and the words travel out through `v_series_guesses_public`, which carries the
gate. One secret, one gate — the reason `guess_key` is not appended to
`v_episode_scores` the way `penalties` was.

One consequence worth knowing before editing any of them: **`create or replace
view` may only append columns to the end of the list.** Re-ordering means
dropping the view, which cascades down the chain above and takes the grants in
`rls.sql` with it.

Scoring lives in **SQL, once**. The dashboard, the leaderboard and the player's
own panel all read the same views, so they cannot disagree — which is exactly the
failure mode of computing it in JavaScript in three places.

Every view filters out `entries.is_disallowed` and `top_picks.is_disallowed`, so
the GM's switch takes effect everywhere at once.

---

## 4. Security

Two secrets that must never reach the browser: the Supabase **service role key**
and the **GM password**. Both live in Vercel environment variables and are only
read inside `/api/*.js`, exactly as in worm-street.

But this project has a third thing to protect: **predictions must be invisible to
other players until the deadline.** A dropdown that hides them in the UI is not
protection — anyone can open devtools and read the network response.

The rule:

> **The anon (browser) key gets `SELECT` on nothing but reference data and
> views that have already passed their reveal. It never gets `SELECT` on
> `predictions`, `entries`, `top_picks`, `series_guesses` or `guess_hits`
> directly.**

There are now **three** reveals, all on the same kind of clock, and each fails
closed on a null date: this week's picks at the episode's own `deadline_at`, the
bake guesses at **episode 1's** `deadline_at`, and the top three at **episode
2's**. One shape, three episodes.

Deriving each from an episode's deadline rather than storing a date — or hanging
one off a button — is the point. `deadline_at` follows `air_date` through
schema.sql's trigger, so there is nothing for a GM to remember and nothing that
can drift. The bake guess gated on `live_at` for about an hour and that was a
bug; §14 records it.

| Who | Reads how |
|-----|-----------|
| A player, their own entry | `POST /api/player` with their code — server returns only their rows |
| Anyone, the dashboard | Anon key on **views that filter on `deadline_at < now()`** — a locked episode's predictions simply aren't in the view yet |
| The GM | `POST /api/gm` with the password, service role, sees everything |

That deadline filter inside the view is the load-bearing line of the whole
system. It gets a comment in the SQL and a test.

RLS on: anon has `SELECT` on `seasons`, `bakers`, `leagues`, `episodes`,
`episode_results`, `categories` and the `v_*` views. **No INSERT, UPDATE or
DELETE for anon anywhere** — every write goes through a serverless function.

One nuance: `episodes.bingo_prompt` for a *future* episode is anon-readable,
which is fine — the prompt is meant to be public before the deadline. Just don't
write next week's prompt in a way that spoils anything.

### Player codes

Two words, e.g. `velvet-crumb`, `soggy-bottom`, `burnt-caramel`. Generated from
two baking lists in `api/_wordlists.js` (≈1,200 combinations) — the wordlist
isn't secret,
because a code also has to exist in the database. Type your code, the server
matches `code_norm`, you're in. Stored in `localStorage` so your friends type it
once.

This is deliberately not real auth. It's a party game; the threat model is a
friend being nosy, not an attacker.

---

## 5. Pages

Real paths, not hash routing. One line in `vercel.json` rewrites everything to
`index.html`.

Nav is four short words so it fits one phone line, worm-street style:

```
BAKE OFF     TABLE · PLAY · BAKERS · RULES
```

| Route | Who | What |
|-------|-----|------|
| `/` | anyone | **The dashboard.** No password. See below. |
| `/play` | player | The prediction panel. Asks for a code if you haven't got one stored. |
| `/bakers` | anyone | The cast grid. |
| `/rules` | anyone | Short-form rules. |
| `/league/<slug>` | anyone | A specific league's dashboard, explicitly |
| `/gm` | you | Password-gated control room. Not in the nav. |

### Which league does the dashboard show?

`/` resolves in this order:

1. **A code in `localStorage`** → that player's league. Your friends open the
   link and land on their own table, automatically. Resolving a code to a league
   would need `/api/player`, so `/play` caches `{ playerId, leagueSlug }` under
   `fbo.who` on every successful login — both public facts, and it keeps the
   dashboard at zero invocations. A browser that logged in before that existed
   spends one call on its first visit and caches the answer.
2. **Nothing stored** → the league flagged `is_default`. With one league running,
   that's everybody.

`/league/<slug>` always overrides both, so you can put any league on a screen
regardless of who's logged in on that device. When a logged-in player is looking
at a league that isn't theirs, the page says so quietly rather than silently
showing a stranger's table.

Making the dashboard the landing page (rather than a login wall) means someone
can be sent the link, immediately see the game, and *then* be told their code.

### The dashboard

The centrepiece. Built to be readable across a room **and** on a phone — most
people will be watching on the sofa with their phone in hand, so this is
**mobile-first, with a wide layout as the enhancement**, not the other way round.

- **Cumulative points chart** — one line per player in their own colour, x-axis
  by episode. Points appear category by category as results land, so the lines
  crawl upward mid-episode. On a phone: the chart is the one element allowed to
  scroll sideways, inside its own container.
- **Leaderboard** — avatar, colour, total, this-week's points, position arrows.
  The default view on a narrow screen.
- **This week's results grid** — the five categories with the winning baker's
  face, filling in live. Categories won by Nobody struck through; ones the GM
  hasn't reached yet left blank.
- **Prediction wall** — everyone's picks, ticking green/red as results land, with
  LATE / VERY LATE flags next to names. The bit people will shout at. Built as a
  table — players down, categories across — because that scales to sixteen
  players where cards don't, and because reading *down* a column is what people
  do with it. It is the one place other than the chart that scrolls sideways.
- **Series recap** — episodes × categories, who won what. ✅ built in phase 5;
  it is where last night's ticks live once an episode is marked complete, since
  the results grid follows the same "current episode" rule as `/play`.
- **Top Three board** — ✅ built in phase 6. Everyone's three, in standings
  order, dead picks greyed and struck rather than dropped — you are stuck with
  your three, and watching them go is most of the fun. It reads
  `v_top_picks_public`, added for it, since `v_series_bonus` carries points only
  and `v_baker_stats` a count per baker. Empty until episode 2's deadline, and
  it says which of the two reasons applies rather than showing a blank.
- **Bake guess board** — ✅ built in phase 8. Everyone's two, in standings
  order, with hits marked and the week they landed. It shares the top three
  board's markup on purpose: the two are the same shape of thing, a
  once-per-series commitment per player, and they read as a pair. Empty until
  **episode 1 goes live** — a third gate on a third clock — and it says which of
  the reasons applies rather than showing a blank.
- **Stats strip** — ✅ built in phase 6. Five cards, **bakers first then
  players**: the week's favourite for Star Baker, the most-written-off baker
  still in the tent, the lone call (something exactly one person got right), the
  biggest single week, and the best hit rate. The two halves answer different
  questions — what the tent is doing, and who among us can read it — and mixing
  them made the strip read as five unrelated facts. **Open by default**, unlike
  the recap: a stat nobody opens is a stat nobody has.

  No queries of its own — every number comes from data the dashboard has already
  fetched, and `src/lib/stats.js` either counts rows SQL already decided or uses
  `verdictFor`, the one derivation the browser is allowed. **Cards with nothing
  to say are not rendered**, so before the first result the panel stays away.

  This is where the **league-flavoured baker stats** live — `picked_best`,
  `picked_leaving` and `in_top_threes` off `v_baker_stats`. They were tried on
  `/bakers` first and moved here: how the league has voted is a fact about the
  players, not about the baker. Note they count across **every league playing
  the season**, since `v_public_predictions` carries rows for all of them and
  `v_baker_stats` is keyed on the baker with no league filter.

On a phone this becomes a vertical stack in that order, with the stats strip and
recap collapsed behind a tap.

### `/bakers`

✅ **Built in phase 6.** A reference grid, so people can remember who's who while
picking. No SQL and no endpoint: `v_baker_stats` already carried everything and
was already granted.

- One card per baker: photo, name, one-line bio.
- Stats fill in as the series runs — Star Bakers, technical wins, handshakes,
  bingo hits, weeks survived. All from `v_baker_stats`, and **anything on zero
  is not rendered at all**, so before episode 1 a card is a face, a name and a
  line.
- **Only what happened in the tent.** No stat here is derived from what players
  predicted, even though `v_baker_stats` carries three that are — those are the
  stats strip's, above. The consequence worth keeping: this page touches no
  prediction data, so it needs no deadline reasoning of any kind.
- **Eliminated bakers go grey and sink to the bottom of the grid**, with the
  episode they left. Sorting is `status`, then `eliminated_episode desc`, then
  `sort_order` — so the freshly departed sit just below the survivors.
- Anon-readable, no login. Fetches once, never polls (§8).

### `/rules`

✅ **Built in phase 6.** The short version of [RULES.md](RULES.md) — the points
table, the deadline, the penalty, the top three, the weird-weeks note and the
final. Not the full document: the scannable version someone opens on a phone two
minutes before the deadline to settle an argument. Static — no fetch, no
endpoint, no login.

**RULES.md stays the long form and the record of decisions.** If the two ever
disagree, RULES.md is right and the page is stale.

One trade worth knowing: the points are **duplicated** from the `categories`
table rather than read from it. That table is config — changing what Star Baker
is worth is a row update — and this page would not follow. It is worth it to
keep `/rules` readable with no network at all, and the numbers have not moved
since RULES §2.1 was written. If they ever do, `v_categories_public` is already
granted and this becomes a five-line fetch.

The colophon at the bottom is Elena's wording, and the attribution half is hers
on purpose — it credits somebody else's game. Note it says **unofficial**: that
site states it is not affiliated with the programme, Channel 4 or Love
Productions, so "official" would be wrong twice over. Earlier drafts of this
document said official; they were wrong.

### The GM panel (`/gm`)

Password once per browser tab — it lives in `sessionStorage`, because unlike a
player's two-word code this one string can rewrite every result in the game, and
the panel gets opened on whatever device is to hand. A 401 asks for it again; a
network hiccup does not, because throwing away a working password mid-episode
means retyping it one-handed. Then tabs:

- **Live** — the episode-night screen. Pick a category, pick a baker, done. Big
  buttons, works on a phone from the sofa. **Add another winner** for the weeks
  with two of something. Four taps per result. This is the only screen you touch
  during an episode.

  Each dropdown has three states: *not decided yet* (no row), **Nobody** (the
  void — nothing happened, so nobody scores), and the bakers. Nobody is chosen
  like any other answer rather than through a separate switch, because on the
  night the question is always "who won this?" and *nobody* is a real answer to
  it. Players never see Nobody as an option — it exists only for recording.
- **Episodes** — theme, air date, deadline, **bingo prompt**, and the
  `upcoming → locked → live → complete` status. "Go live" is the hard lock.
- **Entries** — every entry with its lateness flag, the **Disallow** checkbox,
  and **Open the door** to let one player submit late this week.

  The GM plays too, so this tab shows how many picks each player has made and
  not what they are, until the deadline passes. Same rule as
  `v_public_predictions`, enforced in `api/gm.js` for the same reason.
- **Players** — add players, issue codes, assign colour, per league. No delete:
  it cascades to every entry and prediction, and a name typed wrong can be
  retyped.
- **Bakers** — the cast, photos, bios, elimination status. Marking someone out
  needs the episode they left in, which is why the leaving result fills it in
  for you — but the control stands on its own, because bakers also leave for
  reasons that were never an elimination.
- **Guesses** — ✅ **built.** Everyone's two bakes, grouped by canonical
  wording with the holders named under each. Two jobs at two different times:
  tidy the wordings once, in the window between episode 1's deadline and
  episode 1 airing, then tick whatever came up each week.

  A **season** tab despite being full of people, because `guess_hits` is keyed
  on the season — one tick covers every league, exactly like a result. What is
  per-league is how much it pays, and that arrives per player from SQL. Before
  episode 1's deadline it shows a count and not one word: the GM plays too, and
  has two guesses of their own still to make.
- **Leagues** — ✅ **built.** Add a league with a name and a link, see how many
  players each has, move the default, archive and bring back. No delete: it
  cascades through players to every entry, prediction and top three at once.

  Last in the tab bar, because a league is set up once and then left alone
  while Live is read at speed in a dark room.

**Two kinds of tab, and the panel says which is which.** Live, Episodes, Bakers
and Guesses are about the **season** — one cast, one set of episodes, one set of
results, shared by every league playing it (§2). Entries and Players are about a
**league**, and those two alone carry a league picker under the episode one. A
selector sitting above the Live tab would imply that entering Star Baker affects
one league and not the others, which is the opposite of how this is built, and
episode night is the wrong moment to install that idea.

With several leagues running, Entries and Players group their rosters under
league names rather than listing everyone in the season flat, and each Entries
group carries its own *"3 of 8 in"* — one count across every league is a number
about nobody. The picker shows even with a single league, so it is not a control
that first appears on the evening it matters.

The filtering is done in the browser, not in `api/gm.js`: `state` already
returns every player in the season, the panel does not poll, and a server-side
scope would mean every write action carrying the right `leagueId` or quietly
answering with somebody else's roster. `src/pages/gm/leagueScope.js` holds it.

---

## 6. API surface

Two endpoints. Everything is a `POST` with an `action` field, like worm-street's
`gm.js` / `wexgm.js`.

**`POST /api/player`** — body carries the player's code, always re-verified
server-side.
Built: `login` · `state` · `savePicks` · `saveTopPicks` · `confirm`.
To come: `saveAvatar` (phase 7).

`savePicks` carries **two** things: the week's predictions and, while episode 1
is still open, the two bake guesses. They travel in one request so that there is
one set of lateness and lock rules rather than two that can drift — the guesses
lock on episode 1's ordinary ladder, through the same `lockState` call. It also
means one submission gets one lateness stamp: a request carrying only guesses
would re-stamp the entry and mark this week's picks late for an edit that was
never about them.

`saveEntry` is where the lateness rules live, and all of it is server-side:

```
now < deadline_at                        → on_time
deadline_at < now < live_at              → late
now > live_at, gm_unlocked_at is null    → 403, panel is locked
now > live_at, gm_unlocked_at is set     → very_late
```

`saveTopPicks` runs **the same ladder against episode 2** — literally the same
`lockState()` call, so the two cannot drift. The window opens when episode 1 is
marked complete ("after you have seen everyone bake once") and closes on episode
2's clock, which means one GM door-opening covers both a player's episode-2
picks and their three. That is the right shape: it is one conversation with the
GM, not two.

One request states the whole answer — three bakers or nothing, same as
`setCategory` below — so "exactly three, all different" cannot be broken by a
half-finished edit. It replaces rather than upserts, because `top_picks` is
unique on both `(player_id, rank)` and `(player_id, baker_id)` and swapping two
of your three would otherwise collide with a row the same edit is about to move.

**`POST /api/gm`** — body carries the GM password, checked against
`process.env.GM_PASSWORD` on every call (no sessions, no tokens — same as
worm-street).

Built: `state` · `setCategory` · `setEpisode` · `goLive` · `toggleDisallow` ·
`unlockEntry` · `upsertLeague` · `upsertPlayer` · `generateCode` ·
`upsertBaker` · `setGuess` · `setGuessHit`.

The last two split the bake guess the same way `episode_results` is split:
`setGuess` says what a guess **is** (its canonical wording, or that it is struck
out), `setGuessHit` says what **happened** (this wording came up, in this
episode). Neither awards a point — `v_guess_scores` applies the tiers — so a
game described as "manual" still needs no manual-points column. Re-ticking a key
in a different episode **moves** the hit rather than adding one, because the
unique constraint guarantees a guess pays once and the alternative is fixing a
mis-tap in SQL on episode night.

`upsertLeague` replaced the `createLeague` this section used to promise, for the
same reason `upsertBaker` and `upsertPlayer` are shaped that way: creating and
editing a league differ only in whether an id came with the request. Three
things it enforces that the schema cannot:

- **Slugs are normalised, not validated.** "The Proving Drawer" becomes
  `the-proving-drawer`, and a typed slug goes through the same funnel. The
  result has to match the `/league/<slug>` pattern in `src/App.jsx` — a league
  whose slug the router rejects exists with no way to link to it, which is a
  thing you discover only after sending the link round. Uniqueness is **global**
  rather than per season, because a URL carries no season with it.
- **The default can be moved but never switched off**, and the first league in a
  season takes it automatically. It is what someone opening `/` with no code
  sees, and a season with none makes that landing page arbitrary. Moving it is
  clear-then-set: `leagues_one_default_per_season` permits exactly one, so the
  other order is rejected outright by the index, and this order fails towards a
  moment with no default rather than a moment with two.
- **The default league cannot be archived** — `/` has to land somewhere. The
  panel says so on a disabled button rather than hiding the control, because an
  absent button reads as a missing feature and the only league in a new season
  is always the default.

⚠️ **Archiving is a display change, not a lock.** `v_leagues_public` carries
`where is_active`, so an archived league drops off the dashboard while its data
stays exactly where it is — but `api/player.js` finds a player by their code
alone, with no `is_active` check, so its players can still sign in at `/play`
and submit. Archive a finished league, not one you want to close.

`upsertBaker` holds an invariant the schema does not: `eliminated` always
carries an `eliminated_episode` and every other status carries none, because
`v_baker_stats.weeks_survived` reads that column and treats NULL as "still in".
`setCategory('leaving')` writes it too — naming who left also marks them out —
and reverses itself if the answer changes, but only for a baker eliminated in
that same episode, so a withdrawal recorded by hand survives.

`setCategory` replaced the four verbs this section originally sketched
(`setResult · addResult · clearResult · setNobody`). One request states a
category's whole answer — `'undecided'`, `'nobody'`, or a list of winners — and
the rows are made to match. The invariant that a category is either Nobody or
has winners and never both then has no way to be violated; with four verbs each
one would have to remember to undo the other kind. `setEpisode` absorbed
`setBingoPrompt` for the same reason: one write, one shape.

Every action returns the whole GM state, so the panel never has to guess what
the database now holds — which matters most on the Live tab, where the GM makes
a change every thirty seconds and is not checking whether the screen still
agrees with reality.

The dashboard, `/bakers` and `/rules` need **no endpoint at all** — they read the
`v_*` views straight from Supabase with the anon key. That keeps serverless
invocations near zero even with a dashboard on screen all evening and eight
phones refreshing it.

---

## 7. Colours and avatars

### Colours

Every code is issued with a colour, **unique within its league**, and that colour
is the player's identity everywhere: their chart line, their leaderboard row,
their avatar's base tint, their name on the prediction wall.

Two constraints that pull in different directions, so the palette is worth
getting right once:

- As a **thin line on a chart**, colours need to stay distinguishable at 2px and
  survive a projector or a phone in a bright room.
- As an **avatar fill**, the same colours need to be soft enough to look like
  cake rather than a pie chart.

The answer is one hue per player stored as `colour_hex`, with the avatar
rendering a lightened variant of it in CSS rather than storing a second value.
I'll build the palette properly when we get to the chart (phase 5) — roughly 16
distinguishable hues in tent pastels, checked for the common colour-vision
deficiencies, since a shared chart is exactly where that bites.

### The avatar builder

Your friend draws SVG parts; players assemble one.

**Layers:** `body` (the cake/dessert shape) · `colour` · `eyes` · `mouth`, with
room to add more (hats? sprinkles?) without touching the schema.

**Stored as config, not an image:**

```json
{ "body": "victoria-sponge", "colour": "#e8a0b0",
  "eyes": "sleepy", "mouth": "grin" }
```

in `players.avatar_config`. This matters more than it looks:

- The avatar re-renders crisply at any size — 24px in the leaderboard, 120px on
  the player panel — from one source.
- **New parts can be added mid-series** and every existing avatar keeps working.
  If we stored a rendered PNG, adding a part would mean a migration and a
  re-render of everyone.
- It's a few dozen bytes, so it rides along in every query for free.

**The builder screen:** shown once on first login, and reachable any time from
the player panel. One horizontal carousel per layer, the assembled avatar large
above them, Save. Roughly the shape of a character creator, deliberately — it
takes thirty seconds and it's the first thing people do, so it should be fun.

**What your friend needs to draw:** a set of SVGs per layer, all on the same
viewBox and origin so they stack without alignment work, with the body's fill
left as `currentColor` (or a named class) so one shape serves every colour. I'll
write up exact dimensions and a naming convention when we get there, and drop
them in `src/avatar/parts/` behind a manifest file.

**Until then:** a flat circle in the player's colour with their initial. The
`avatar_config` column sits empty, the `<Avatar>` component falls back, and
nothing else in the app knows the difference — so this can land in phase 7
without touching anything built before it.

---

## 8. Live updates

Polling, not websockets — the same call worm-street made, for the same reason:
it's ~5 lines and it never mysteriously stops.

| Screen | Interval | Notes |
|--------|---------:|-------|
| Dashboard | **4s** while the episode is `live` | Backs off to 30s otherwise |
| `/play` | **on focus** | No timer. Refreshes on `focus` / `visibilitychange` |
| GM Live tab | 5s | So two devices don't fight |
| `/bakers`, `/rules` | none | Fetch once |

All dashboard polling is against anon-readable views, so it costs Supabase reads
— effectively unlimited at this scale — and zero Vercel invocations.

If it feels laggy on the night, Supabase Realtime is a drop-in upgrade for the
dashboard only.

### Why `/play` doesn't poll

This started as a 20s poll and became a refresh on focus in phase 4
([src/lib/useRefreshOnFocus.js](src/lib/useRefreshOnFocus.js)).

`/play` is a form you fill in once a week. A 20s timer would spend roughly
58,000 Vercel invocations across the series keeping a screen up to date that
nobody is looking at, and its one genuinely ticking element — the countdown — is
local already and needs no network at all
([src/lib/useCountdown.js](src/lib/useCountdown.js)). Refreshing when the tab
comes back to the front is fresh the moment you open it and silent otherwise.

Two things follow from it:

- **The scorecard half is free.** It reads the granted views with the
  publishable key, so a phone reopened twenty times during an episode costs no
  Vercel invocations. Only the `/api/player` half (picks, the lock, the bingo
  prompt) is an invocation, and it is skipped while the form has unsaved
  changes — a fresh `state.picks` would re-sync the form and throw those edits
  away. No rule rests on the skip: `savePicks` re-derives the lock from the
  server clock and answers 403 if the episode has started meanwhile.
- **The dashboard is unaffected**, and deliberately so. Points landing live
  while everyone watches is the whole point of the product, and it polls
  Supabase directly — so the 4s interval costs nothing on Vercel either.

---

## 9. Environment variables

| Name | Where | What |
|------|-------|------|
| `SUPABASE_URL` | Vercel + `.env.local` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Vercel + `.env.local` only** | Bypasses RLS. Server-side; never imported under `src/`. |
| `GM_PASSWORD` | **Vercel + `.env.local` only** | One password, all leagues |
| anon key | hardcoded in `src/lib/supabase.js` | Public by design — it ships in the bundle either way |

`.env.local` is git-ignored. Production values go in the Vercel dashboard under
Project → Settings → Environment Variables.

---

## 10. Build order

Each phase ends somewhere usable, so we can stop and play if the series starts
before we're finished.

| Phase | Deliverable | Blocks |
|------:|-------------|--------|
| **0** | ✅ Repo scaffolded, Supabase project, deployed to Vercel, shell live | everything |
| **1** | ✅ *written* — schema, views, RLS, seed, smoke test and the code generator in [supabase/](supabase/). **Not yet applied**: paste them in the order in [supabase/README.md](supabase/README.md). Bakers and air dates wait on the announcement. | 2, 3 |
| **2** | ✅ `/play` — login, prediction panel, deadline countdown, Confirm, lateness | playable |
| **3** | ✅ `/gm` — all five tabs: Live, Episodes, Entries, Players, Bakers. | scoring |
| **4** | ✅ Scoring wired up; the scorecard and standings on `/play`. Adds `v_episode_results_public` — **paste `views.sql` and `rls.sql` again** | 5 |
| **5** | ✅ `/` dashboard — chart, leaderboard, results grid, prediction wall, and the series recap from §5. **No SQL**: every view it needs was already granted, so there is nothing to paste. | showable |
| **6** | ✅ `/bakers`, top-three picks and series bonuses (picker on `/play`, board on `/`), the stats strip, and `/rules`. The top three adds `v_top_picks_public` and gates `v_baker_stats.in_top_threes` — **paste `views.sql`, `rls.sql` and `smoke_test.sql` again**; nothing else in the phase needed SQL | — |
| **7** | Avatar builder with your friend's SVGs; visual design pass | — |
| **8** | ✅ **The bake guess** — two bakes per player, named before episode 1, ticked weekly by the GM and scored 5/2/0 in SQL. Adds `series_guesses` and `guess_hits`, so **paste `schema.sql` first**, then `views.sql`, `rls.sql` and `smoke_test.sql`. See §14 | — |

**Minimum to run week 1: phases 0–4.** The dashboard can arrive in week 2 without
losing any data — results are recorded either way and the chart back-fills.

---

## 11. Design direction

Thin on purpose — worth a proper pass once it works. Placeholders:

- **Palette:** tent pastels — dusty pink, sage, cream, pale blue — on off-white,
  with one strong accent for "live" states. Not literal bunting.
- **Type:** something warm for headings, plain sans for numbers.
- **Mobile first**, everywhere. The dashboard included.
- **No dark mode.** This is a display for a lit room.

---

## 12. Running costs

£0. Supabase free tier (500MB, far past what a few hundred predictions need) and
Vercel hobby. A custom domain, if you ever want one, is ~£10/year — otherwise
`fantasy-bakeoff.vercel.app`.

---

## 13. Risks and their answers

| Risk | Answer |
|------|--------|
| **A prediction leaks before the deadline** | The deadline filter lives in the SQL view, not the UI. Written once, commented, tested. |
| **A VERY LATE entry is made by someone who's seen the answers** | Can't be prevented once you allow it — which is why the door opens per player, per week, by the GM only, and the flag is loud. |
| **You're too busy watching to enter results** | The Live tab is four taps per result and works on a phone. Results back-fill fine afterwards. |
| **A rule changes mid-series** | Points live in `categories`; scoring is views. Recalculation is instant and retroactive across every league. |
| **Someone loses their code** | GM → Players shows every code. |
| **Two devices editing at once** | Predictions upsert per `(entry, category)`; last write wins. Fine for this. |
| **Vercel/Supabase down on the night** | Results are back-fillable, so a bad hour costs the live feel, not the data. |

---

## 14. The bake guess — built

✅ **Phase 8, built on 2026-09-09.** Elena's idea, worked through and redesigned
the same day once the first version turned out to be spoilable. RULES §6 is the
canonical rulebook version; this section is the architecture and the reasoning.

Adds two tables and two views, so the paste order for this one is
**`schema.sql` → `views.sql` → `rls.sql` → `smoke_test.sql`** — schema first,
unusually, because the views have nothing to read without the tables.

### The game

**Once per series, before episode 1**, every player names **two bakes** they
think will come up — "madeleine", "croquembouche", "choux". Free text, invented
by the player. A guess pays out the week it appears, once:

| Who said it | If it comes up |
|---|---:|
| Only that player | **+5** |
| Exactly two players | **+2 each** |
| Three or more | **0** |
| It never comes up | **0** |

Maximum 10 for a perfect pair — meaningful beside the top three's 15 and a good
week's 13, without dominating.

### Why once per series, and why before episode 1

**The first design was per-episode and it does not work.** Each week's teaser
and episode description between them pretty much state what is going to be
baked, so a guess made after the previous episode is barely a guess at all.

Timing fixes that, not a rule: **a teaser can only spoil the next episode, so a
commitment made once for the whole series is structurally unspoilable.** That is
why this borrows the top three's shape.

It locks **before episode 1**, though, where the top three deliberately locks
after. The top three needs you to have watched everyone bake; this needs the
opposite. Nothing about episode 1 helps you guess the series' vocabulary, and
locking at episode 2 would leave episode 1's challenges already public — either
a freebie or a carve-out. Locking with the first weekly picks means all ten
episodes are live, the guess is completely blind, and week 1 has something to
do. It also keeps week 2 from carrying both this and the top three.

### Locked and revealed at episode 1's deadline

The same instant, and the same shape as the top three one episode later: the
guesses lock and go public at episode 1's `deadline_at`, where the three lock
and go public at episode 2's. Fail-closed on a null deadline, no new machinery.

**This first gated on `live_at`, and that was a bug worth recording**, because
`live_at` still looks like the more precise answer to "has episode 1 aired?"
It is stamped only by the Go live button and cleared by Take it back — and Take
it back was the *only* route from `live` to `complete`, so every episode reached
"over" with a null `live_at` and the board emptied exactly when the episode
finished. Elena found it within minutes of the first paste. Two fixes went in:
the Episodes tab can now reach Complete directly from Live (which is the right
behaviour regardless — "take it back" means *it was never on air*), and the gate
moved to `deadline_at`, which follows `air_date` through schema.sql's trigger
and depends on no button at all.

**What the old design bought, and what losing it costs.** The gap between lock
and reveal was the GM's private window to unify wordings. It is gone: the GM now
sees the list at the same moment as everyone else. That is survivable because
the board publishes `guess_text` — what the player typed, which nothing ever
edits — and never `guess_key`. Unifying moves points, not words, and no points
can land until a guess is ticked, which is during episode 1 at the earliest. So
the GM still has the same few hours; they are simply not private.

**What it costs that is real:** RULES §6's late-guess warning now applies to
LATE as well as VERY LATE. Anyone submitting after the deadline can see what
everybody took and pick something nobody has. The answer is the same as before —
`is_disallowed` and the GM's judgement — and the rules say so.

### The GM ticks; SQL still scores

Each week the GM marks which guesses came up. **This is a fact being recorded,
not a score being awarded** — the same shape as `episode_results`, where the GM
says what happened and the views work out what it is worth.

That distinction is why this design needs **no manual-points column**. An
earlier draft of this section proposed one; it is not needed, the scoring stays
in SQL, and `smoke_test.sql` can assert the tiers like everything else. The §2
boundary holds with no exception at all.

Two properties fall out:

- **The weekly job shrinks.** A guess pays once, so a hit resolves it and it
  drops off the list. Week 1 is a scan of ~15 distinct guesses; by week 6 it is
  a handful.
- **These points have an honest episode**, unlike the top-three bonus.
  `v_series_bonus` carries no episode, which is why it can never appear on the
  chart or produce movement. A guess hits *in a specific week*, so it steps the
  line and moves the table on the night it lands — the live-scoring feel the
  series bonus cannot have.

### Store what they typed AND what it was unified to

The one thing to get right, because unifying is **scoring-relevant**: turning
someone's "madeleines" into "madeleine" can move them from sole (+5) to shared
(+2).

- **`guess_text`** — what the player typed. Never edited.
- **`guess_key`** — the GM's canonical version. This is what scoring counts, and
  what the weekly tick list groups by.

The wall shows what they wrote, the scoring uses the key, and the edit is
auditable. One column, and it removes a whole class of argument at a watch-along
where the GM is also a player.

### What was built

- [x] **`series_guesses`** — `id, player_id, slot (1-2), guess_text, guess_key,
      submitted_at, is_late, is_disallowed`. Unique on `(player_id, slot)` and
      on `(player_id, guess_key)` — two different guesses, the same way
      `top_picks` enforces three different bakers.
- [x] **`guess_hits`** — `season_id, guess_key, episode_id`. One row per guess
      that came up, keyed on the canonical form so one tick covers every player
      holding it. Unique on `(season_id, guess_key)`: a guess pays once, and
      that constraint IS the rule rather than a check the view performs.
- [x] **`v_series_guesses_public`** — gated on episode 1's `deadline_at`,
      granted in `rls.sql`. Carries the hit and its episode as well as the
      words, so the board needs one query rather than two.
- [x] **`v_guess_scores`** — per player per guess: `holders`, the hit's
      `episode_id`, and `points` by the table above. **Not granted** — it names
      the guesser beside the guess with no gate of its own.
- [x] **`v_episode_scores`** — `guess_points` appended, and the spine widened
      (see below).
- [x] **`/play`** — two text inputs while episode 1 is open, a receipt
      afterwards, saved through `savePicks`.
- [x] **GM panel** — a Guesses tab, grouped by key with the holders named, an
      editable `guess_key` per holder, a strike-out switch, and one tick per key.
- [x] **Dashboard** — `GuessBoard`, everyone's two with hits and the week they
      landed.
- [x] **`smoke_test.sql`** — the reveal gate fails closed on both a null and a
      future deadline *and* genuinely opens; it does not depend on `live_at`;
      the 5/2/0 tiers; a guess pays once, not once per episode; holders counted
      per league; and a struck-out guess leaving the holders count.
- [x] **`RULES.md` §6 and `/rules`** — the tiers, the lock, and the two
      questions below, settled.

### Three decisions taken while building it

**`is_disallowed` on `series_guesses`, which this section did not originally
ask for.** The section said a VERY LATE guess would be handled "by hand"; with
no column, by hand meant in the SQL editor. It is the same switch `entries` and
`top_picks` carry, the GM panel has a Strike out button for it, and it is
filtered out of the **holders count** as well as the payout — a struck guess
that still counted towards the tier would silently drop everybody else from +5
to +2, which is the opposite of "as if it were never made".

**Holders are counted per LEAGUE, not per season.** Seasons are shared by every
league playing them (§2), so a season-wide count would let a stranger in another
league take a player's +5 away and turn it into +2. Points belong to a league
because the leaderboard does. Note this is the **opposite** call from
Still-open #10, where the baker stats count season-wide — the difference is that
those are a stat and these are points.

**`v_episode_scores` carries `guess_points` and NOT the guess itself.** That view
is granted to anon with no gate of its own, so a `guess_key` column there would
be a second way to read the guesses on a different clock from
`v_series_guesses_public`'s. One secret, one gate. The words reach the dashboard
through the gated view and reach a player's own panel through `/api/player`,
which is authenticated. It is the one place this design departs from the
penalties precedent, where a `penalties` jsonb *does* ride along — penalties are
not a secret.

### The spine of `v_episode_scores` had to widen

`v_episode_scores` was built on `entries`, one row per player per episode they
entered. A guess pays in the week it comes up, and that may be a week the player
made no picks in — so an entries-only spine had nowhere to put the points and
would have dropped them silently.

It is now `entries UNION the weeks a guess paid in`. Only a guess that actually
**paid** pulls in a new row: a guess that came up but was too popular to score
has nothing to deliver, and a 0-point row for somebody who sat that week out
would draw them on the chart for an episode they were never in. `lateness` is
therefore nullable on those rows — there is no entry, so there is no submission
to be late — and every reader already treats it as a flag rather than a value.

### Not going in the code

**VERY LATE entries should not score this category** — RULES §2.5 already warns
they can see everyone else's picks, and here that would let someone guarantee a
unique answer. Elena will handle it by hand rather than in code.

### Deliberately not built: task names

The GM ticks guesses and does **not** record each episode's actual challenge
names. Attribution still works — a tick says "madeleine came up in episode 3",
so the recap can say Priya called it — but the *task names themselves*
("Signature: 12 identical madeleines") are not captured.

That is a separate wish, worth having for the recap in its own right, and
nothing here should be shaped so as to prevent adding it later.

### The two open questions, settled

Both were Elena's to answer and both are now in RULES §6. They turned out to
have **one** answer between them, which is why neither needed a line of SQL:

1. **Does the showstopper count?** ✅ **Yes — all three challenges count**, but
   the showstopper counts *by the name it is given*.
2. **Do elements within a showstopper count?** ✅ **No — whole bakes only.**

The thing that collapsed them into one rule: **the challenge titles are stated
explicitly on the programme**, so the title is the record. A guess hits when the
word is in the announced title of the signature, the technical or the
showstopper. A chocolate egg sitting on a bigger showstopper is not a hit;
"Chocolate Egg Showstopper" is.

That is a far more checkable rule than "whole bakes only" on its own — it
replaces a judgement about what counts as a bake with a question that has one
answer per challenge, which matters because the GM is ruling live while also
playing.

It also settles the "cake" case, which was noted as probably falling out of
those two and does: a guess must be a specific bake, ingredient or technique,
and the GM may reject one before the lock — but the tiers mostly handle it
anyway, since an obvious guess attracts company and pays nothing.

---

## Still open

| # | Question |
|---|----------|
| 1 | **Series start date** — ten episodes confirmed; the date isn't announced yet, expected late September 2026. Episodes are seeded with numbers and a null `air_date`; dates fill in when announced and the deadline follows automatically. |
| 2 | ✅ **The cast** — announced and applied. [supabase/cast_2026.sql](supabase/cast_2026.sql) renamed the twelve placeholders in place, so their ids survived along with the test picks made against them. Photos are **hotlinked** from the broadcaster; `photo_url` is nullable and `/bakers` falls back to a monogram, so a dead link degrades rather than breaks. **Left over:** the phase 3/4 test results are now attached to real names — Gabe reads as eliminated in episode 1, Gary as a Star Baker — and want clearing before the link goes round. |
| 3 | ✅ **Colophon** — settled and shipped: *"This game is a home-made version of the unofficial [Fantasy Bake Off](https://fantasybakeoff.co.uk/). Built with Claude."* **Unofficial**, not official: that site states it is not affiliated with the programme, Channel 4 or Love Productions. |
| 4 | **How many players?** Sets the identity-palette size — 16 hues is comfortable, beyond ~20 they stop being tellable apart even beside a name. |
| 5 | A display face for headings (DESIGN.md §9) — must be freely licensable |
| 6 | ✅ **The bake guess (§14): does the showstopper count?** **Yes — all three challenges**, the showstopper by the name it is given. |
| 7 | ✅ **The bake guess (§14): do elements within a showstopper count?** **No — whole bakes only.** The challenge titles are stated explicitly on the programme, so the guess has to appear in the announced title. That one observation settled both questions and kept the whole ruling out of the code — it is RULES §6 and `/rules`, and no SQL depends on it. |
| 8 | **A league switcher on the dashboard?** Everyone already lands on their own table; this would let them look at another without knowing its slug. `resolveLeague` already fetches every league, so it costs no query. The trade is discoverability: it turns other leagues from "you need the link" into "they are listed". Not a leak — `v_leagues_public` is granted and lists them all already — but a change of tone. |
| 9 | **Should archiving a league lock its players out?** Today it does not: `api/player.js` finds a player by their code alone. Right if archiving means "last year's league", wrong if it means "these people are out". Two lines in `player.js` either way. |
| 10 | **The stats strip's baker numbers count every league in the season**, since `v_public_predictions` carries rows for all of them and `v_baker_stats` is keyed on the baker with no league filter. Invisible with one league; with three, "written off" shows the same number on every league's dashboard. Arguably "written off by half the country" is the better stat, but it should be a decision. Fixing it means a league filter on a view keyed the wrong way, and a `views.sql` paste. |

**Settled since v0.2:** the league is **In The Oven** (`in-the-oven`), and Elena
is both GM and player (`players.is_gm`).

**Multiple leagues, decided while building the GM side:** results stay per
season, so a second league costs nothing on the night; there is no delete, only
archiving; the default may be moved but not switched off; and a person in two
leagues is two players with two codes, because `players.league_id` is a single
FK and the browser stores one code — so one device is one league identity. One
GM password still covers every league (§9): **multiple leagues is not multiple
GMs**, and anyone given the password can rewrite every result in all of them.
