# Fantasy Bake Off

A fantasy league for *The Great British Bake Off*, built for a group of friends
watching the 2026 series together.

**Live at [fantasy-bakeoff.vercel.app](https://fantasy-bakeoff.vercel.app/)**

Every week, before the episode airs, each player picks a baker for five
categories: Star Baker, who leaves, the technical winner, a Hollywood handshake,
and a "bingo" event the GM writes for that week. Points come in **live while the
episode is on**, so the leaderboard moves as everyone watches. There are also
season-long bets, like your final three and two guesses about bakes, and several
leagues can run side by side on the same series.

The full scoring rules are in [RULES.md](RULES.md).

**Stack:** React + Vite · Supabase (Postgres) · Vercel serverless functions

## How it works

- **Players** log in with a two-word code (no accounts, no emails) and make their
  picks at `/play`.
- **The GM** runs things from a password-protected control room at `/gm`, setting
  up episodes, writing the bingo prompt and entering results as they happen.
- **Everyone** can see the dashboard at `/`, which has the leaderboard, a points
  chart, the results grid and the wall of everyone's predictions.

Picks are secret until the episode airs. The database enforces this, not the UI:
every table is locked with row-level security, and the browser can only read a
small set of views. Those views hide each episode's predictions until its
broadcast time. All scoring is done once, in SQL, so every page shows the same
numbers.

## Documentation

This repo is documented in some depth. If you're going to change something,
read these first:

| File | What's in it |
|---|---|
| [RULES.md](RULES.md) | How the game is played and scored |
| [HANDOFF.md](HANDOFF.md) | Current state, what each phase built, and known traps |
| [TECH_PLAN.md](TECH_PLAN.md) | Architecture, data model and API |
| [DESIGN.md](DESIGN.md) | The visual system and design tokens |
| [supabase/README.md](supabase/README.md) | SQL run order, and why the views are the security boundary |

---

Build with Claude Opus 4.4/4.5. 
