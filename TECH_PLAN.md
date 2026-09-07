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

---

## 3. Data model

```
seasons ──┬── bakers
          ├── episodes ──── episode_results
          └── leagues ──┬── players ──┬── entries ──── predictions
                        │             └── top_picks
                        └── (settings)
```

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
v_episode_scores     -- player × episode → points, incl. penalties
v_standings          -- player → cumulative points, rank, rank change
v_series_bonus       -- top-3 finalist + winner bonuses
v_baker_stats        -- per baker: star bakers, technicals, handshakes,
                     --   weeks survived, how often picked, how often
                     --   predicted to leave and didn't  (feeds /bakers)
```

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
> deadline-passed views. It never gets `SELECT` on `predictions`, `entries` or
> `top_picks` directly.**

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
   link and land on their own table, automatically.
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
  LATE / VERY LATE flags next to names. The bit people will shout at.
- **Series recap** — episodes × categories, who won what.
- **Top Three board** — from episode 2, everyone's three, dead ones greyed.
- **Stats strip** — most-picked baker of the week, best lone call (something only
  one person got right), per-player accuracy by category, the
  most-predicted-to-leave baker who keeps surviving, biggest weekly haul.

On a phone this becomes a vertical stack in that order, with the stats strip and
recap collapsed behind a tap.

### `/bakers`

A reference grid, so people can remember who's who while picking.

- One card per baker: photo, name, one-line bio.
- Stats fill in as the series runs — Star Bakers, technical wins, handshakes,
  weeks survived, and league-flavoured ones like *"picked to leave 7 times,
  still here"*. All from `v_baker_stats`.
- **Eliminated bakers go grey and sink to the bottom of the grid**, with the
  episode they left. Sorting is `status`, then `eliminated_episode desc`, then
  `sort_order` — so the freshly departed sit just below the survivors.
- Anon-readable, no login.

### `/rules`

The short version of [RULES.md](RULES.md) — the points table, the deadline, the
penalty, the top three, and the weird-weeks note. Not the full document; the
scannable version people will actually read on a phone before picking.

At the bottom, a short colophon: that you built this with Claude, and that the
game is based on the official Fantasy Bake Off. *(Send me the exact wording and
the link you want to point at — I don't want to guess at the attribution.)*

### The GM panel (`/gm`)

Password once, then tabs:

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
- **Players** — add players, issue codes, assign colour, per league.
- **Bakers** — the cast, photos, bios, elimination status.
- **Leagues** — create and manage parallel leagues; set the default.

---

## 6. API surface

Two endpoints. Everything is a `POST` with an `action` field, like worm-street's
`gm.js` / `wexgm.js`.

**`POST /api/player`** — body carries the player's code, always re-verified
server-side.
`login` · `getEntry` · `saveEntry` · `confirmEntry` · `saveTopPicks` ·
`saveAvatar`

`saveEntry` is where the lateness rules live, and all of it is server-side:

```
now < deadline_at                        → on_time
deadline_at < now < live_at              → late
now > live_at, gm_unlocked_at is null    → 403, panel is locked
now > live_at, gm_unlocked_at is set     → very_late
```

**`POST /api/gm`** — body carries the GM password, checked against
`process.env.GM_PASSWORD` on every call (no sessions, no tokens — same as
worm-street).
`setResult` · `addResult` · `clearResult` · `setNobody` · `setEpisode` · `goLive` ·
`setBingoPrompt` · `toggleDisallow` · `unlockEntry` · `upsertPlayer` ·
`upsertBaker` · `createLeague` · `generateCode`

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
| Player panel | 20s | Just the countdown and the bingo prompt |
| GM Live tab | 5s | So two devices don't fight |
| `/bakers`, `/rules` | none | Fetch once |

All dashboard polling is against anon-readable views, so it costs Supabase reads
— effectively unlimited at this scale — and zero Vercel invocations.

If it feels laggy on the night, Supabase Realtime is a drop-in upgrade for the
dashboard only.

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
| **3** | `/gm` — Episodes, Live results entry, Entries tab with Disallow and unlock | scoring |
| **4** | Scoring views wired up; standings on `/play` | 5 |
| **5** | `/` dashboard — chart, leaderboard, results grid, prediction wall | showable |
| **6** | `/bakers`, `/rules`, top-three picks and series bonuses, stats strip | — |
| **7** | Avatar builder with your friend's SVGs; visual design pass | — |

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

## Still open

| # | Question |
|---|----------|
| 1 | **Series start date** — ten episodes confirmed; the date isn't announced yet, expected late September 2026. Episodes are seeded with numbers and a null `air_date`; dates fill in when announced and the deadline follows automatically. |
| 2 | **The cast** — twelve placeholder bakers are seeded so the panel works. Rename them when the real names land (keeps their ids, so test picks survive). |
| 3 | **Exact colophon wording** for `/rules`, and the link for "the official Fantasy Bake Off" |
| 4 | **How many players?** Sets the identity-palette size — 16 hues is comfortable, beyond ~20 they stop being tellable apart even beside a name. |
| 5 | A display face for headings (DESIGN.md §9) — must be freely licensable |

**Settled since v0.2:** the league is **In The Oven** (`in-the-oven`), and Elena
is both GM and player (`players.is_gm`).
