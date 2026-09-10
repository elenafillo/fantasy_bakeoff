-- ============================================================
-- Fantasy Bake Off — schema
-- ============================================================
-- Run order: schema.sql → views.sql → rls.sql → seed.sql
-- Paste each into the Supabase SQL editor. See supabase/README.md.
--
-- Shape, in one line: results hang off the SEASON (one GM entry updates every
-- league), players and predictions hang off a LEAGUE.

-- ------------------------------------------------------------
-- Seasons
-- ------------------------------------------------------------

create table if not exists seasons (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  year          int  not null,
  episode_count int  not null default 10,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Bakers
-- ------------------------------------------------------------

create table if not exists bakers (
  id                 uuid primary key default gen_random_uuid(),
  season_id          uuid not null references seasons(id) on delete cascade,
  name               text not null,
  photo_url          text,
  bio_line           text,
  -- 'finalist' means reached the final; 'winner' implies finalist for the
  -- top-three bonus, which is why v_series_bonus counts both.
  status             text not null default 'active'
                     check (status in ('active','eliminated','finalist','winner')),
  eliminated_episode int,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  unique (season_id, name)
);

create index if not exists bakers_season_idx on bakers (season_id, status);

-- NOTE: that status = 'eliminated' always has an eliminated_episode, and that
-- every other status has none, is enforced in api/gm.js (upsertBaker), not
-- declaratively — the same arrangement as the Nobody/winners invariant below.
-- It matters because v_baker_stats.weeks_survived reads that column and treats
-- NULL as "still in", so an elimination with no number quietly counts as a full
-- run of the series.
--
-- api/gm.js also keeps this table in step with the leaving result: naming a
-- baker as leaving episode N marks them eliminated at N, and taking them back
-- out of that result puts them back — but only if they are eliminated AT N, so
-- a withdrawal recorded by hand in another week is never reverted by it.

-- ------------------------------------------------------------
-- Leagues
-- ------------------------------------------------------------

create table if not exists leagues (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid not null references seasons(id) on delete cascade,
  name       text not null,
  slug       text not null unique,
  is_default boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Exactly one default league per season — it is what an anonymous visitor to
-- "/" sees, so two would make the landing page arbitrary.
create unique index if not exists leagues_one_default_per_season
  on leagues (season_id) where is_default;

-- ------------------------------------------------------------
-- Players
-- ------------------------------------------------------------

create table if not exists players (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references leagues(id) on delete cascade,
  display_name  text not null,
  -- The two-word login code, normalised: lowercased, non-letters stripped.
  -- A code IS the credential, so this column is never exposed to anon — see
  -- rls.sql, and v_players_public which deliberately omits it.
  code_norm     text not null unique,
  colour_hex    text not null check (colour_hex ~* '^#[0-9a-f]{6}$'),
  avatar_config jsonb not null default '{}'::jsonb,
  is_gm         boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Two players in the same league sharing a colour would make the leaderboard
-- and the chart ambiguous. Across leagues it is fine — they never appear
-- together.
create unique index if not exists players_colour_per_league
  on players (league_id, colour_hex);

-- ------------------------------------------------------------
-- Categories — scoring config, not code
-- ------------------------------------------------------------
-- Changing what Star Baker is worth is an UPDATE here. Because scoring is
-- views, the change is retroactive across every league the moment it lands.

create table if not exists categories (
  key        text primary key,
  label      text not null,
  points     int  not null,
  sort_order int  not null,
  applies_to text not null default 'regular'
             check (applies_to in ('regular','final','both'))
);

-- ------------------------------------------------------------
-- Episodes
-- ------------------------------------------------------------

create table if not exists episodes (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references seasons(id) on delete cascade,
  number       int  not null,
  theme        text,
  air_date     date,
  -- 18:00 UK on the day of the episode. Derived from air_date by the trigger
  -- below. NULL until the schedule is announced — and a NULL deadline means
  -- predictions stay private (views.sql fails closed on this).
  deadline_at  timestamptz,
  -- Stamped when the GM opens live scoring. The hard lock, and the boundary
  -- between LATE and VERY LATE.
  live_at      timestamptz,
  bingo_prompt text,
  status       text not null default 'upcoming'
               check (status in ('upcoming','locked','live','complete')),
  is_final     boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (season_id, number)
);

-- Deadlines are 18:00 Europe/London on the air date. Storing timestamptz and
-- converting from the named zone means British Summer Time is Postgres's
-- problem — a series running from September into November crosses the change,
-- and a hardcoded +01:00 would silently move the deadline by an hour.
create or replace function fbo_derive_deadline(d date)
returns timestamptz language sql immutable as $$
  select (d + time '18:00') at time zone 'Europe/London';
$$;

create or replace function fbo_set_episode_deadline()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.air_date is not null and new.deadline_at is null then
      new.deadline_at := fbo_derive_deadline(new.air_date);
    end if;
  -- On update, follow air_date only when the caller did not also set the
  -- deadline themselves. That keeps a deliberate override (a one-off early
  -- deadline, say) from being overwritten by this trigger.
  elsif new.air_date is distinct from old.air_date
        and new.deadline_at is not distinct from old.deadline_at then
    new.deadline_at := case
      when new.air_date is null then null
      else fbo_derive_deadline(new.air_date)
    end;
  end if;
  return new;
end $$;

drop trigger if exists episodes_set_deadline on episodes;
create trigger episodes_set_deadline
  before insert or update on episodes
  for each row execute function fbo_set_episode_deadline();

-- ------------------------------------------------------------
-- Episode results
-- ------------------------------------------------------------
-- SEVERAL ROWS PER CATEGORY ARE LEGAL AND EXPECTED: two bakers going home, two
-- handshakes, a bingo event that catches three people. Naming any one of them
-- scores once — the scoring view uses EXISTS, not a join, so a player cannot
-- collect the points twice (RULES §3).

create table if not exists episode_results (
  id         uuid primary key default gen_random_uuid(),
  episode_id uuid not null references episodes(id) on delete cascade,
  category   text not null references categories(key),
  baker_id   uuid references bakers(id) on delete cascade,
  -- `voided` is what the UI calls "Nobody". The GM never flips a switch: they
  -- pick Nobody from the same dropdown as a baker, because on the night the
  -- question is always "who won this?" and nobody is a real answer to it. Same
  -- row, friendlier word — RULES §3.
  voided     boolean not null default false,
  entered_at timestamptz not null default now(),
  -- Nobody is one row with no baker. A result is a row with a baker and no
  -- void flag. Nothing else is a valid shape.
  --
  -- Note what has NO row at all: a category the GM has not reached yet. "Nobody
  -- won it" and "not decided yet" are different states and the dashboard shows
  -- them differently, so do not let the UI collapse them.
  constraint result_shape check (
    (voided and baker_id is null) or (not voided and baker_id is not null)
  )
);

-- The same baker cannot win the same category twice in one episode.
create unique index if not exists results_unique_winner
  on episode_results (episode_id, category, baker_id) where not voided;

-- At most one void row per category per episode.
create unique index if not exists results_one_void
  on episode_results (episode_id, category) where voided;

-- NOTE: that a category is either Nobody OR has winners — never both — is
-- enforced in api/gm.js (choosing Nobody deletes the winner rows, and adding a
-- winner deletes the Nobody row), not declaratively.
-- If both somehow coexist, scoring treats the winners as live and ignores the
-- void, because v_prediction_scores filters on `not voided`.

create index if not exists results_episode_idx
  on episode_results (episode_id, category);

-- ------------------------------------------------------------
-- Entries — one per player per episode
-- ------------------------------------------------------------
-- All the entry-level state lives here rather than on each prediction row:
-- lateness, Confirm, Disallow and the GM's unlock are decisions about a WEEK,
-- not about a single pick.

create table if not exists entries (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references players(id) on delete cascade,
  episode_id     uuid not null references episodes(id) on delete cascade,
  submitted_at   timestamptz not null default now(),
  confirmed_at   timestamptz,
  -- Computed server-side in api/player.js from submitted_at against the
  -- episode's deadline_at / live_at. The client's clock is never trusted.
  lateness       text not null default 'on_time'
                 check (lateness in ('on_time','late','very_late')),
  is_disallowed  boolean not null default false,
  -- Non-null is the only thing that permits a write after live_at (RULES §2.5).
  gm_unlocked_at timestamptz,
  unique (player_id, episode_id)
);

create index if not exists entries_episode_idx on entries (episode_id);

-- ------------------------------------------------------------
-- Predictions — one row per category
-- ------------------------------------------------------------
-- Tall, not wide. Scoring becomes a single join against episode_results on
-- (episode_id, category); multiple correct answers and voided categories then
-- need no special cases. See TECH_PLAN §3.

create table if not exists predictions (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references entries(id) on delete cascade,
  category   text not null references categories(key),
  baker_id   uuid not null references bakers(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (entry_id, category)
);

-- ------------------------------------------------------------
-- Top three bakers
-- ------------------------------------------------------------

create table if not exists top_picks (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references players(id) on delete cascade,
  baker_id      uuid not null references bakers(id) on delete cascade,
  rank          int  not null check (rank between 1 and 3),
  submitted_at  timestamptz not null default now(),
  is_late       boolean not null default false,
  is_disallowed boolean not null default false,
  unique (player_id, rank),
  -- You cannot pick the same baker twice.
  unique (player_id, baker_id)
);

-- ------------------------------------------------------------
-- The bake guess — two bakes, once, before episode 1
-- ------------------------------------------------------------
-- RULES §6. Every player names two bakes they think will come up during the
-- series. A guess pays out the week it appears, ONCE: +5 if they were the only
-- one who said it, +2 each if exactly two of them did, nothing if three or more
-- did, and nothing if it never comes up.
--
-- It locks before episode 1 where the top three locks after, and the reasons
-- are opposite: the top three needs you to have watched everyone bake, and this
-- needs you to have watched nothing. A teaser can only spoil the next episode,
-- so a commitment made once for the whole series cannot be spoiled by one.
--
-- TWO COLUMNS FOR ONE ANSWER, and the difference between them is the whole
-- design:
--
--   guess_text   what the player typed. NEVER edited, by anyone.
--   guess_key    the GM's canonical form. This is what scoring counts.
--
-- Unifying is SCORING-RELEVANT — turning "madeleines" into "madeleine" can move
-- somebody from sole (+5) to shared (+2) — so the board shows what they wrote,
-- the scoring uses the key, and the edit is auditable. One column, and it
-- removes a whole class of argument at a watch-along where the GM is also a
-- player.

create table if not exists series_guesses (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references players(id) on delete cascade,
  slot          int  not null check (slot between 1 and 2),
  guess_text    text not null,
  guess_key     text not null,
  submitted_at  timestamptz not null default now(),
  is_late       boolean not null default false,
  -- The GM's switch, and the only way a guess leaves scoring. It is what makes
  -- the VERY LATE case handleable: RULES §2.5 warns that a player let in after
  -- the episode starts can already see everyone else's picks, and here that
  -- would let them guarantee themselves a unique guess. Every scoring view
  -- filters on it, INCLUDING the holders count — see v_guess_scores.
  --
  -- Note it is separate from entries.is_disallowed. A guess is not part of a
  -- week's entry, so striking a week's picks leaves the guess standing and
  -- vice versa.
  is_disallowed boolean not null default false,
  unique (player_id, slot),
  -- Two DIFFERENT guesses, the same way top_picks enforces three different
  -- bakers. On the KEY rather than the text, so that unifying two of somebody's
  -- guesses into one is refused rather than silently halving their chances —
  -- api/gm.js turns that refusal into a sentence.
  unique (player_id, guess_key)
);

-- v_guess_scores groups every guess in a league by this column.
create index if not exists series_guesses_key_idx on series_guesses (guess_key);

-- One row per guess that came up, keyed on the CANONICAL form so that a single
-- tick covers every player holding it — which is what makes the GM's weekly job
-- shrink as the series runs: a hit resolves a guess and it drops off the list.
create table if not exists guess_hits (
  id         uuid primary key default gen_random_uuid(),
  -- Denormalised from episodes.season_id, and it earns its place: the unique
  -- constraint below needs the SEASON as its scope. Keyed on the episode alone,
  -- the same guess could be ticked again in a later week and pay twice.
  -- api/gm.js checks the episode really does belong to the season.
  season_id  uuid not null references seasons(id) on delete cascade,
  guess_key  text not null,
  episode_id uuid not null references episodes(id) on delete cascade,
  entered_at timestamptz not null default now(),
  -- A GUESS PAYS ONCE. This constraint is the whole of that rule — the scoring
  -- view cannot pay twice for a key that cannot be ticked twice.
  unique (season_id, guess_key)
);

create index if not exists guess_hits_episode_idx on guess_hits (episode_id);

-- ------------------------------------------------------------
-- Season settings
-- ------------------------------------------------------------
-- When the top three lock, and therefore when they become public. Kept on the
-- season rather than hardcoded, because "the Tuesday before episode 2" is a
-- date we won't know until the schedule is announced.

-- ⚠️ `top_picks_lock_at` IS DEAD. Nothing reads it and nothing writes it.
--
-- It stored the moment the top three lock, which RULES §5 defines as 18:00 on
-- the Tuesday before episode 2 — i.e. episode 2's own deadline. Storing it
-- separately meant two dates that could disagree, and a second GM control to
-- keep in step. Both the lock (api/player.js) and the reveal
-- (v_top_picks_public) now derive from episode 2's `deadline_at`, so there is
-- exactly one answer and it follows `air_date` through the trigger below.
--
-- Left in place rather than dropped because dropping it buys nothing. DO NOT
-- wire it back up: a second source of truth for the lock is the bug this
-- removed.
create table if not exists season_settings (
  season_id        uuid primary key references seasons(id) on delete cascade,
  top_picks_lock_at timestamptz
);
