# Database

Paste these into the Supabase SQL editor **in order**. Each is idempotent, so a
failed run can be fixed and re-run.

| # | File | What it does |
|---|------|--------------|
| 1 | [schema.sql](schema.sql) | Tables, indexes, the deadline trigger |
| 2 | [views.sql](views.sql) | Scoring, and the browser's entire read surface |
| 3 | [rls.sql](rls.sql) | Locks every table, grants the views |
| 4 | [seed.sql](seed.sql) | Categories, the season, the league, ten episodes |
| 5 | [smoke_test.sql](smoke_test.sql) | Proves scoring and the reveal gates work |

`seed.sql` finishes with a row of counts. `smoke_test.sql` returns a row reading
**SMOKE TEST PASSED**, or an error naming the rule that broke. Run it after
**any** change to `views.sql`.

**Re-pasting after a change usually means `views.sql` → `rls.sql` → smoke test.
Phase 8 is the exception**: the bake guess added two TABLES, so `schema.sql` has
to go first or `views.sql` has nothing to read. It is `create table if not
exists` throughout, so re-pasting it is safe on a live database and changes
nothing that is already there.

The verdict is a `SELECT`, not a `RAISE NOTICE`: notices don't appear in the
Supabase SQL editor, so a passing run would be indistinguishable from one that
did nothing.

## Two things that are easy to get wrong

**`views.sql` is a permission boundary, not just queries.** The browser can read
those views and nothing else, so adding a column or loosening a `WHERE` publishes
data to the internet. The one that matters most:

```sql
where ep.deadline_at is not null    -- fails closed: no deadline = not public
  and ep.deadline_at <= now();
```

That is the whole of "nobody sees your picks before the deadline". Hiding
predictions in the UI would be defeated by anyone opening devtools.

**That shape now appears three times, on three different clocks**, and each one
fails closed on a null date:

| View | Gate | Protects |
|---|---|---|
| `v_public_predictions` | episode's own `deadline_at` | this week's picks |
| `v_top_picks_public` | **episode 2's** `deadline_at` | whose three is whose |
| `v_series_guesses_public` | **episode 1's** `deadline_at` | everyone's bake guesses |

One shape, three episodes. Each is **derived from an episode** rather than
stored or hung off a button, so it follows `air_date` through the deadline
trigger and there is nothing for a GM to remember. The bake guess briefly gated
on `live_at` instead — see TECH_PLAN §14 for why that was a bug.

**The views are security-definer on purpose.** They read their tables as the
view owner, which is how they can expose a slice of a table the browser has no
access to. Supabase's linter flags this; it is the documented exception. Do not
"fix" it by enabling `security_invoker` — every view would return nothing.

## Players

Codes are credentials, so they are never committed:

```bash
node scripts/generate-players.mjs --league proving-drawer --gm Elena Elena Sam Tom
node scripts/generate-players.mjs --league proving-drawer --append Jo      # later arrivals
```

Writes `players.seed.sql` (git-ignored) and prints a roster to hand out one line
at a time. No two codes in a league share a word, since they get read aloud
across a room.

**The file is append-only.** Each `--append` run parses the earlier blocks to
avoid reissuing a code, a word or a colour — deleting a block breaks that.

## The cast

[placeholder_bakers.sql](placeholder_bakers.sql) adds twelve stand-ins so
`/play` works end to end before the cast is announced.

[cast_2026.sql](cast_2026.sql) then renames those twelve to the real 2026 cast
and gives each a bio line and a photo. It **updates in place**, so the ids stay
put and any picks already made against a placeholder survive. Keyed on
`sort_order` rather than on the placeholder names, so it is idempotent — re-run
it to fix a bio or swap a photo URL.

Neither file touches a view, a grant or a policy, so there is nothing to re-paste
afterwards and `smoke_test.sql` is unaffected. Renaming by hand in the GM panel
does the same job, one baker at a time.

## A known limitation

There is no rate limiting on `/api/player`. The wordlists are public and there
are ~1,200 combinations, so someone determined could enumerate codes and submit
as another player. A failed login sleeps 400ms, which slows a script rather than
stopping one.

For a league of friends this is the right trade — codes are cheap to reissue and
predictions become public at the deadline anyway. If it ever matters, the fix is
a small `login_attempts` table keyed by IP.

## Still to seed

- **Bakers** — announced. Paste [cast_2026.sql](cast_2026.sql); until then the
  twelve placeholders are still in there under their stand-in names.
- **Air dates** — episodes are seeded with numbers only. Setting `air_date`
  fills `deadline_at` in automatically at 18:00 Europe/London, British Summer
  Time handled. Until then the deadline is NULL and that episode's predictions
  stay private.
- **Nothing else.** `season_settings.top_picks_lock_at` used to be listed here
  and is **dead** — the top three lock at episode 2's own `deadline_at`, derived
  rather than stored, so there is no second date to keep in step. See the
  warning on it in [schema.sql](schema.sql), and do not wire it back up.
