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
  voided     boolean not null default false,
  entered_at timestamptz not null default now(),
  -- A void is one row with no baker. A result is a row with a baker and no
  -- void. Nothing else is a valid shape.
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

-- NOTE: that a category is either voided OR has winners — never both — is
-- enforced in api/gm.js (voiding deletes the winner rows), not declaratively.
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
-- Season settings
-- ------------------------------------------------------------
-- When the top three lock, and therefore when they become public. Kept on the
-- season rather than hardcoded, because "the Tuesday before episode 2" is a
-- date we won't know until the schedule is announced.

create table if not exists season_settings (
  season_id        uuid primary key references seasons(id) on delete cascade,
  top_picks_lock_at timestamptz
);
