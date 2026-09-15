import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { resolveLeague } from '../lib/dashboard.js'
import { Panel } from '../components/Panel.jsx'

/**
 * The cast grid — who's who, for people deciding their picks (TECH_PLAN §5).
 *
 * Anon-readable, no login, and no endpoint: it reads `v_baker_stats`, which is
 * granted to the publishable key and is the only granted view that publishes
 * every baker's name, photo and bio.
 *
 * It fetches ONCE and does not poll (TECH_PLAN §8). This is the reference page
 * you open while deciding your picks, not the live one — the dashboard is where
 * points land as they happen, and `v_baker_stats` is twelve correlated
 * subqueries, which is exactly what you do not want inside a four-second loop.
 * A baker eliminated mid-episode needs a reload here, and that is the trade.
 */
export default function Bakers() {
  const [league, setLeague] = useState(null)
  const [cast, setCast] = useState(null)
  const [error, setError] = useState(null)

  // Bakers hang off a season, not a league, but which season depends on the
  // league you are looking at — so this resolves it the same way `/` does, and
  // for the same reasons (TECH_PLAN §5).
  useEffect(() => {
    let cancelled = false
    resolveLeague(null)
      .then((next) => { if (!cancelled) setLeague(next.league) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!league) return
    let cancelled = false
    supabase
      .query('v_baker_stats', {
        select:
          'baker_id,name,photo_url,bio_line,status,eliminated_episode,sort_order,' +
          'star_bakers,technical_wins,handshakes,bingo_hits,weeks_survived',
        params: { season_id: `eq.${league.season_id}` },
      })
      .then((rows) => { if (!cancelled) setCast(rows) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [league])

  // Survivors first, then the freshly departed, then the rest (TECH_PLAN §5).
  // Sorted here rather than in the query because PostgREST cannot express the
  // status ranking, and twelve rows do not need it to.
  const sorted = useMemo(() => {
    if (!cast) return []
    return [...cast].sort(
      (a, b) =>
        RANK[a.status] - RANK[b.status] ||
        (b.eliminated_episode ?? 0) - (a.eliminated_episode ?? 0) ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name)
    )
  }, [cast])

  if (error) {
    return (
      <Panel head="The tent">
        <h1>The tent isn’t loading</h1>
        <p className="notice bad" role="alert">{error}</p>
      </Panel>
    )
  }

  if (!cast) {
    return (
      <Panel head="The tent">
        <p className="muted">Opening the tent…</p>
      </Panel>
    )
  }

  if (sorted.length === 0) {
    return (
      <Panel head="The tent">
        <h1>The bakers</h1>
        <p className="muted">No bakers yet — the cast lands in the GM panel.</p>
      </Panel>
    )
  }

  const left = sorted.filter((b) => b.status === 'eliminated').length
  const inTent = sorted.length - left

  return (
    <Panel head="The tent">
      <h1>The bakers</h1>
      <p className="small muted cast-count">
        {inTent} still in
        {left > 0 && <> · {left} gone home</>}
      </p>
      {/* The broadcaster's own cast page, which carries the full-length
          profiles this page deliberately does not — a card here is a face, a
          name and one line, and anyone who wants the rest should get it from
          the source rather than from a paraphrase of it that would rot.
          The year is hardcoded: `seasons.year` exists but is not on any
          granted view, and widening one to carry a link is not worth a
          permission-boundary change (CLAUDE.md, invariant 1). */}
      <p className="small cast-link">
        <a
          href="https://thegreatbritishbakeoff.co.uk/meet-the-class-of-2026/"
          target="_blank"
          rel="noreferrer noopener"
        >
          Click here to read the full descriptions
        </a>
      </p>
      <ul className="cast">
        {sorted.map((baker) => (
          <BakerCard key={baker.baker_id} baker={baker} />
        ))}
      </ul>
    </Panel>
  )
}

const RANK = { winner: 0, finalist: 1, active: 2, eliminated: 3 }

function BakerCard({ baker }) {
  // The photos are hotlinked from the broadcaster, so one going missing is a
  // question of when, not whether. The monogram is the fallback and the card
  // reads perfectly well without a face — `photo_url` is nullable and every
  // baker starts with none.
  const [broken, setBroken] = useState(false)
  const gone = baker.status === 'eliminated'
  const face = baker.photo_url && !broken

  // NOTHING ON THIS PAGE IS DRIVEN BY WHAT PLAYERS PREDICTED. `v_baker_stats`
  // also carries `picked_best`, `picked_leaving` and `in_top_threes`, and an
  // earlier draft printed the wry one ("written off twice, still here"). It
  // came out: this is the cast reference you read while deciding your picks,
  // and a stat about how the league has voted is a fact about the players, not
  // about the baker. Those belong in the dashboard's stats strip.
  //
  // Two things follow from keeping them off. The page shows only what happened
  // in the tent, so it needs no deadline reasoning of any kind — and it dodges
  // `in_top_threes`, which is granted but has no lock gate (see HANDOFF).
  //
  // Empty prints nothing at all: before episode 1 a card is a face, a name and
  // a line, which is the whole of what this page is for until there are results.
  const foot = gone
    ? `Left in episode ${baker.eliminated_episode ?? '—'}`
    : baker.weeks_survived > 0
      ? `${weeks(baker.weeks_survived)} in the tent`
      : null

  return (
    <li className={`cast-card ${gone ? 'gone' : ''}`}>
      {face ? (
        <img
          className="cast-face"
          src={baker.photo_url}
          /* Decorative: the name is right beside it in the heading, so
             announcing the photo too would just say everything twice. */
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="cast-face blank" aria-hidden="true">
          {(baker.name || '?').trim().charAt(0).toUpperCase()}
        </span>
      )}

      <div className="cast-body">
        <h2 className="cast-name">
          {baker.name}
          {baker.status === 'winner' && <span className="pill ok"><span className="dot" />Winner</span>}
          {baker.status === 'finalist' && <span className="pill"><span className="dot" />Finalist</span>}
        </h2>

        {baker.bio_line && <p className="cast-bio">{baker.bio_line}</p>}

        {/* Achievements only once there are any. Twelve cards of zeroes on the
            morning of episode 1 would be noise, and the stats are supposed to
            fill in as the series runs (TECH_PLAN §5). */}
        <Chips baker={baker} />

        {foot && <p className="small muted cast-foot">{foot}</p>}
      </div>
    </li>
  )
}

/** The achievements, as chips. Anything on zero is left out entirely. */
function Chips({ baker }) {
  const chips = ACHIEVEMENTS.map(([key, label]) =>
    baker[key] > 0 ? (
      <li key={key} className="cast-chip">
        <b>{baker[key]}</b> {label(baker[key])}
      </li>
    ) : null
  ).filter(Boolean)

  if (chips.length === 0) return null
  return <ul className="cast-chips">{chips}</ul>
}

const ACHIEVEMENTS = [
  ['star_bakers', () => 'Star Baker'],
  ['technical_wins', (n) => (n === 1 ? 'technical' : 'technicals')],
  ['handshakes', (n) => (n === 1 ? 'handshake' : 'handshakes')],
  ['bingo_hits', (n) => (n === 1 ? 'bingo' : 'bingos')],
]

const weeks = (n) => `${n} week${n === 1 ? '' : 's'}`
