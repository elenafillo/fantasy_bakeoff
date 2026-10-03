import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { categoriesFor, fetchLive, fetchReference, resolveLeague, seriesFor } from '../lib/dashboard.js'
import { movementFor } from '../lib/scores.js'
import { Panel } from '../components/Panel.jsx'
import { Leaderboard } from '../components/Leaderboard.jsx'
import { PointsChart } from '../components/PointsChart.jsx'
import { ResultsGrid } from '../components/ResultsGrid.jsx'
import { PredictionWall } from '../components/PredictionWall.jsx'
import { SeriesRecap } from '../components/SeriesRecap.jsx'
import { TopThreeBoard } from '../components/TopThreeBoard.jsx'
import { GuessBoard } from '../components/GuessBoard.jsx'
import { StatsStrip } from '../components/StatsStrip.jsx'
import { LeagueSwitcher } from '../components/LeagueSwitcher.jsx'
import { buildStats } from '../lib/stats.js'
import { Link } from '../lib/Link.jsx'

/**
 * The league dashboard, and the app's landing page.
 *
 * No password, no endpoint. Every view it reads is granted to the publishable
 * key, so this page on a screen all evening plus eight phones in the room costs
 * zero Vercel invocations — which is the whole reason it is built this way
 * (TECH_PLAN §6) and the reason the 4s poll below is affordable.
 *
 * It polls on a timer rather than refreshing on focus, which is the opposite of
 * /play and deliberately so (TECH_PLAN §8, src/lib/useRefreshOnFocus.js):
 * points landing live while everyone watches is the whole point of the product,
 * and nobody is going to tab away and back to find out whether Star Baker has
 * been called.
 */
export default function Dashboard({ slug }) {
  const [resolved, setResolved] = useState(null)
  const [reference, setReference] = useState(null)
  const [live, setLive] = useState(null)
  const [error, setError] = useState(null)
  const [stale, setStale] = useState(false)
  const [lines, setLines] = useState(null)

  // ---- which league ----
  // Nothing is cleared here on the way in: App.jsx keys this component on the
  // slug, so moving between leagues remounts it and every piece of state below
  // starts empty. Clearing it by hand would be four setState calls made
  // synchronously inside an effect, which React's rules reject — and rightly,
  // since it is a second render for something the key does for free.
  useEffect(() => {
    let cancelled = false
    resolveLeague(slug)
      .then((next) => { if (!cancelled) { setResolved(next); setError(null) } })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [slug])

  const league = resolved?.league ?? null

  // ---- reference data, once ----
  // Categories and baker names don't change during an episode, so they stay out
  // of the poll (TECH_PLAN §8 fetches /bakers once for the same reason).
  useEffect(() => {
    if (!league) return
    let cancelled = false
    fetchReference(league)
      .then((next) => { if (!cancelled) setReference(next) })
      .catch((err) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [league])

  // ---- the poll ----
  // 4s while the episode is airing, 30s the rest of the week (TECH_PLAN §8).
  // `is_live` is computed in v_episodes_public from the episode's lock time, so
  // this needs no clock of its own. It used to read `status === 'live'`, which
  // the GM set by pressing Go live — and a forgotten tap left the dashboard
  // polling every 30s through the one hour the 4s interval exists for.
  const interval = live?.currentEpisode?.is_live ? 4000 : 30000

  useEffect(() => {
    if (!league) return
    let cancelled = false

    const load = () =>
      fetchLive(league)
        .then((next) => { if (!cancelled) { setLive(next); setStale(false) } })
        .catch((err) => {
          if (cancelled) return
          // Not swallowed into an empty table: supabase.js throws rather than
          // returning [] precisely so a missing grant cannot read as "nobody
          // has scored". What is already on screen stays there.
          console.error('[dashboard]', err)
          setStale(true)
        })

    load()
    const stop = supabase.subscribe(load, interval)
    return () => { cancelled = true; stop() }
  }, [league, interval])

  // ---- chart line states ----
  // Everyone muted, the top three and you full (DESIGN §6). Set once, from the
  // first table that arrives, and then left alone: the default is a starting
  // point, not a rule that reasserts itself over the reader every time the
  // table reshuffles mid-episode.
  const standings = live?.standings ?? []
  if (lines === null && standings.length > 0) {
    setLines(
      Object.fromEntries(
        standings.map((row) => [
          row.player_id,
          row.position <= 3 || row.player_id === resolved?.you ? 'full' : 'muted',
        ])
      )
    )
  }

  const cycle = (id) =>
    setLines((prev) => ({ ...prev, [id]: NEXT[prev?.[id] ?? 'muted'] }))

  // Against the shown episode, not the current one: for the days between
  // marking a week complete and the next deadline, "since last week" means
  // since before the week just finished (pickShown).
  const movement = useMemo(() => {
    if (!live?.shownEpisode) return {}
    return Object.fromEntries(
      live.standings.map((row) => [
        row.player_id,
        movementFor({
          table: live.standings,
          perEpisode: live.scores,
          playerId: row.player_id,
          episodeNumber: live.shownEpisode.number,
        }),
      ])
    )
  }, [live])

  const chart = useMemo(
    () => (live ? seriesFor({ standings: live.standings, scores: live.scores }) : { last: 0, series: [] }),
    [live]
  )

  const stats = useMemo(
    () =>
      live && reference
        ? buildStats({
            predictions: live.predictions,
            results: live.results,
            scores: live.scores,
            standings: live.standings,
            bakerNames: reference.bakerNames,
            bakers: reference.bakers,
            // This league's revealed picks across the series, every category.
            // Counted here rather than on v_baker_stats or picks_made so that
            // every card on the strip is about this league, and so the hit rate
            // can leave out categories nobody won (stats.js).
            seriesPicks: live.seriesPicks,
            // The wall's week, not the page's. The two cards built from picks —
            // the favourite and the lone call — are about what is on the wall a
            // screen above, so they trail with it for the days it holds last
            // week's (pickWall).
            episode: live.wallEpisode,
          })
        : [],
    [live, reference]
  )

  if (error) {
    return (
      <Panel head="The table">
        <h1>The table isn’t loading</h1>
        <p className="notice bad" role="alert">{error}</p>
      </Panel>
    )
  }

  if (resolved?.missing) {
    return (
      <Panel head="The table">
        <h1>No league called “{slug}”</h1>
        <p className="muted">
          Check the link, or <Link to="/">open the main table</Link>.
        </p>
      </Panel>
    )
  }

  if (!league) {
    return (
      <Panel head="The table">
        <p className="muted">
          {resolved ? 'There are no leagues yet.' : 'Opening the table…'}
        </p>
      </Panel>
    )
  }

  if (!live || !reference) {
    return (
      <Panel head={league.name}>
        <p className="muted">Loading the table…</p>
      </Panel>
    )
  }

  const episode = live.currentEpisode
  const categories = categoriesFor(reference.categories, episode)
  const thisWeek = live.results.filter((r) => r.episode_id === episode?.id)
  // The week just marked complete, until the next deadline (pickShown). It
  // keeps a results box of its own and owns the leaderboard's week column.
  const shown = live.shownEpisode
  const last = shown && shown.id !== episode?.id ? shown : null
  const hasBonus = live.standings.some((r) => r.bonus_points !== 0)

  // Usually the same episode. For a few days after one is marked complete the
  // wall keeps showing it while everything else moves on (pickWall).
  const wall = live.wallEpisode
  const wallCategories = categoriesFor(reference.categories, wall)
  const wallResults = live.results.filter((r) => r.episode_id === wall?.id)

  return (
    <>
      <Panel>
        <div className="dash-head">
          <div>
            <h1>{league.name}</h1>
            <p className="small muted" style={{ margin: 0 }}>
              {episode
                ? `Episode ${episode.number} of ${live.episodes.length}`
                : 'No episodes yet'}
              {' · '}
              {live.standings.length} player{live.standings.length === 1 ? '' : 's'}
            </p>
          </div>
          {stale && <span className="pill"><span className="dot" />Not updating</span>}
        </div>

        {/* Said quietly, not hidden: someone looking at a league that isn't
            theirs should know, and it is usually deliberate — a league put up
            on a screen in another room. */}
        {resolved.yours && resolved.yours.slug !== league.slug && (
          <p className="small muted dash-note">
            You play in {resolved.yours.name}.{' '}
            <Link to={`/league/${resolved.yours.slug}`}>Your table</Link>.
          </p>
        )}
      </Panel>

      <Leaderboard
        standings={live.standings}
        scores={live.scores}
        episode={shown}
        states={lines ?? {}}
        onCycle={cycle}
        movement={movement}
        meId={resolved.you}
      />

      <PointsChart
        series={chart.series}
        last={chart.last}
        states={lines ?? {}}
        onCycle={cycle}
        hasBonus={hasBonus}
      />

      {/* Last week first: it is where the news is, and the box goes at the
          next deadline, leaving the current one where it always sits. */}
      {last && (
        <ResultsGrid
          categories={categoriesFor(reference.categories, last)}
          results={live.results.filter((r) => r.episode_id === last.id)}
          episode={last}
          last
        />
      )}

      <ResultsGrid categories={categories} results={thisWeek} episode={episode} />

      <PredictionWall
        categories={wallCategories}
        predictions={live.predictions}
        standings={live.standings}
        bakerNames={reference.bakerNames}
        results={wallResults}
        scores={live.scores}
        episode={wall}
        nextEpisode={wall?.id !== episode?.id ? episode : null}
        meId={resolved.you}
      />

      {/* Straight under the wall, because two of its cards — the favourite and
          the lone call — are read against it, and follow its week (pickWall). */}
      <StatsStrip stats={stats} />

      {/* Below the wall and the numbers, above the recap: it changes about four
          times a series, so it sits under everything that changes weekly — but
          it is a live story ("three people are riding on Priya"), not history,
          so it stays out of the recap. */}
      <TopThreeBoard
        topPicks={live.topPicks}
        standings={live.standings}
        episodeTwo={live.episodes.find((e) => e.number === 2) ?? null}
      />

      {/* Below the top three, which is the more consequential commitment — 15
          points against 10 — and the one that changes what people shout at the
          screen. Both are once-per-series, so both sit under everything that
          moves weekly. */}
      <GuessBoard
        guesses={live.guesses}
        standings={live.standings}
        episodeOne={live.episodes.find((e) => e.number === 1) ?? null}
      />

      <SeriesRecap
        episodes={live.episodes}
        results={live.results}
        categories={reference.categories}
      />

      <LeagueSwitcher leagues={resolved.siblings} shownId={league.id} />
    </>
  )
}

const NEXT = { full: 'muted', muted: 'hidden', hidden: 'full' }
