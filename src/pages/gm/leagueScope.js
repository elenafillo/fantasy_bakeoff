// ============================================================
// Which league the people-shaped tabs are showing
// ============================================================
// Entries and Players are the only two tabs that are about a LEAGUE. Live,
// Episodes, Bakers and Guesses are about the SEASON — one cast, one set of
// episodes, one set of results, shared by every league playing it
// (TECH_PLAN §2). That is why the picker in the shell appears over these two and
// nowhere else: a league selector sitting above the Live tab would imply that
// entering Star Baker affects one league and not the others, which is the exact
// opposite of how this is built, and episode night is the wrong moment to
// install that idea.
//
// GUESSES IS A SEASON TAB EVEN THOUGH IT SHOWS PEOPLE, and that is worth being
// clear about because it looks like an exception. `guess_hits` is keyed on the
// season, so ticking "madeleine came up" is one fact typed once and every
// league's dashboard moves — exactly like a result. What IS per-league is how
// much it pays, since holders are counted inside a league (views.sql), and that
// arithmetic happens in SQL and arrives per player. So the tab lists everybody
// holding a guess with what it is worth to each of them, and needs no picker.
//
// The filtering happens HERE, in the browser, and not in api/gm.js. buildState
// already returns every player in the season, the panel does not poll, and a
// server-side scope would mean every write action carrying the right leagueId
// or silently answering with somebody else's roster. Worth revisiting only if a
// league ever gets big enough for the payload to matter.

export const ALL = 'all'

/**
 * Active leagues first, then alphabetical — archived ones sink, the way
 * eliminated bakers do on the Bakers tab.
 */
export const byLeagueOrder = (a, b) =>
  Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name)

/**
 * People, split into the leagues they play in.
 *
 * One group when a single league is in view — the ordinary case, and the one
 * that must not grow a heading naming something there is no alternative to —
 * and one group per league otherwise, so that a flat alphabetical list of
 * everybody in the season never appears. Reading down twenty-four interleaved
 * names for the three who have not submitted is the thing this exists to
 * prevent.
 */
export function groupByLeague(people, leagues, leagueId) {
  const wanted =
    leagueId === ALL
      ? [...leagues].sort(byLeagueOrder)
      : leagues.filter((l) => l.id === leagueId)

  return wanted
    .map((league) => ({ league, people: people.filter((p) => p.league_id === league.id) }))
    // An empty league is worth showing when you have picked it — that is the
    // answer to "has anybody joined yet?" — but not when you are looking at all
    // of them, where it is a heading with nothing underneath it.
    .filter((g) => g.people.length > 0 || wanted.length === 1)
}
