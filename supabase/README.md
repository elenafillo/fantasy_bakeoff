# Database

Paste these into the Supabase SQL editor **in order**. Each is idempotent, so a
failed run can be fixed and re-run.

| # | File | What it does |
|---|------|--------------|
| 1 | [schema.sql](schema.sql) | Tables, indexes, the deadline trigger |
| 2 | [views.sql](views.sql) | Scoring, and the browser's entire read surface |
| 3 | [rls.sql](rls.sql) | Locks every table, grants the views |
| 4 | [seed.sql](seed.sql) | Categories, the season, the league, ten episodes |
| 5 | [smoke_test.sql](smoke_test.sql) | Proves scoring and the deadline gate work |

`seed.sql` finishes with a row of counts. `smoke_test.sql` returns a row reading
**SMOKE TEST PASSED**, or an error naming the rule that broke. Run it after
**any** change to `views.sql`.

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

## Trying it before the cast is announced

`/play` needs bakers to pick from. [placeholder_bakers.sql](placeholder_bakers.sql)
adds twelve stand-ins so the panel works end to end. Rename them in the GM panel
when the real cast lands — that keeps their ids, so any test picks survive — or
delete them, which cascades to predictions.

## A known limitation

There is no rate limiting on `/api/player`. The wordlists are public and there
are ~1,200 combinations, so someone determined could enumerate codes and submit
as another player. A failed login sleeps 400ms, which slows a script rather than
stopping one.

For a league of friends this is the right trade — codes are cheap to reissue and
predictions become public at the deadline anyway. If it ever matters, the fix is
a small `login_attempts` table keyed by IP.

## Still to seed

- **Bakers** — the cast isn't announced. GM panel → Bakers, an insert, or the
  placeholders above.
- **Air dates** — episodes are seeded with numbers only. Setting `air_date`
  fills `deadline_at` in automatically at 18:00 Europe/London, British Summer
  Time handled. Until then the deadline is NULL and that episode's predictions
  stay private.
- **`top_picks_lock_at`** in `season_settings` — 18:00 on the Tuesday before
  episode 2.
