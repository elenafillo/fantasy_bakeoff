import { useEffect, useRef, useState } from 'react'
import { Panel } from './Panel.jsx'
import { HowToRead, Note } from './HowToRead.jsx'

/**
 * Cumulative points, one line per player.
 *
 * Hand-rolled SVG, no chart library (TECH_PLAN §1). Every number arrives
 * already worked out; seriesFor in lib/dashboard.js only runs a total forward
 * through the episodes.
 *
 * THE CONSTRAINT THIS IS BUILT AROUND: only four series hues are validated, and
 * a fifth genuinely breaks — red against orange measures ΔE 7.1 to ordinary
 * vision against a floor of 15 (DESIGN §5). There are two players today and the
 * identity palette is sized for about sixteen, so this has to work with a dozen
 * lines on it. What makes that possible is not colour:
 *
 *   Three states per line — full, muted at 25%, hidden — cycled by tapping a
 *   leaderboard row or a legend chip, so the reader chooses how many lines are
 *   shouting at once. Everyone starts muted except the top three and you.
 *
 *   A direct label on every full line. Mandatory, not decoration: with a dozen
 *   hues available, the label is the only thing that actually identifies
 *   anyone. Muted lines are texture and don't need telling apart.
 *
 *   A plain table of the same numbers, always reachable, for anyone the colours
 *   fail. Not optional either.
 *
 * The label is drawn in ink with a short dash of the player's colour beside it,
 * rather than in the colour itself. Aqua sits at 2.82:1 on white — fine for a
 * 2.5px line, and below the floor for 12px text. The dash carries the hue, the
 * ink carries the name.
 *
 * Colour follows the PLAYER, from players.colour_hex, never their rank: the
 * table reshuffles mid-episode and nobody's line may change colour underneath
 * them.
 */

const PAD = { l: 32, r: 98, t: 14, b: 26 }
const HEIGHT = 220
const PER_EPISODE = 56
const MIN_WIDTH = 300
const LABEL_GAP = 15

export function PointsChart({ series, last, states, onCycle, hasBonus }) {
  const boxRef = useRef(null)
  const measured = useElementWidth(boxRef)
  const [hover, setHover] = useState(null)

  const stateOf = (s) => states[s.player.player_id] ?? 'muted'

  if (!series.length || last === 0) {
    return (
      <Panel head="The season so far">
        <p className="muted">
          The chart draws itself as soon as the first episode is scored. One line
          per player, in their own colour.
        </p>
      </Panel>
    )
  }

  // The chart is the ONE element allowed to scroll sideways on a phone
  // (DESIGN §6), inside its own container — so it takes the room it needs per
  // episode and stretches to fill anything wider.
  const width = Math.max(measured || MIN_WIDTH, PAD.l + PAD.r + last * PER_EPISODE)
  const plotW = width - PAD.l - PAD.r
  const plotH = HEIGHT - PAD.t - PAD.b

  const { ticks, lo, hi } = scaleFor(series)
  const x = (n) => PAD.l + (n / last) * plotW
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * plotH

  const visible = series.filter((s) => stateOf(s) !== 'hidden')
  // Muted first so the full lines sit on top of the pack rather than in it.
  const drawn = [...visible].sort((a, b) => Number(stateOf(a) === 'full') - Number(stateOf(b) === 'full'))

  const labels = spread(
    visible
      .filter((s) => stateOf(s) === 'full')
      .map((s) => ({
        id: s.player.player_id,
        name: s.player.display_name,
        colour: s.player.colour_hex,
        y: y(s.points[last].total),
      })),
    PAD.t + 5,
    HEIGHT - PAD.b,
    LABEL_GAP
  )

  return (
    <Panel head="The season so far">
      <div className="chart-scroll" ref={boxRef}>
        <div className="chart-inner" style={{ width }}>
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Cumulative points after each episode, ${series.length} players. The same numbers are in the table below.`}
            onPointerMove={(e) => {
              // Mouse only. On a phone a tap here would fight the sideways
              // scroll, and touch already has the leaderboard rows and the
              // legend chips to work the lines with.
              if (e.pointerType !== 'mouse') return
              const box = e.currentTarget.getBoundingClientRect()
              const n = Math.round(((e.clientX - box.left - PAD.l) / plotW) * last)
              setHover(n >= 0 && n <= last ? n : null)
            }}
            onPointerLeave={() => setHover(null)}
          >
            {/* Recessive gridlines, y from zero (DESIGN §6). */}
            {ticks.map((v) => (
              <g key={v}>
                <line className={v === 0 && lo < 0 ? 'chart-zero' : 'chart-grid'}
                  x1={PAD.l} x2={PAD.l + plotW} y1={y(v)} y2={y(v)} />
                <text className="chart-axis" x={PAD.l - 6} y={y(v) + 4} textAnchor="end">{v}</text>
              </g>
            ))}

            {Array.from({ length: last }, (_, i) => i + 1).map((n) => (
              <text key={n} className="chart-axis" x={x(n)} y={HEIGHT - 8} textAnchor="middle">{n}</text>
            ))}

            {drawn.map((s) => {
              const full = stateOf(s) === 'full'
              return (
                <polyline
                  key={s.player.player_id}
                  points={s.points.map((p) => `${x(p.n)},${y(p.total)}`).join(' ')}
                  fill="none"
                  stroke={s.player.colour_hex}
                  strokeWidth={full ? 2.5 : 1.5}
                  strokeOpacity={full ? 1 : 0.25}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )
            })}

            {/* No markers except the final point. */}
            {visible.filter((s) => stateOf(s) === 'full').map((s) => (
              <circle
                key={s.player.player_id}
                cx={x(last)} cy={y(s.points[last].total)} r="4"
                fill={s.player.colour_hex} stroke="#fff" strokeWidth="1.5"
              />
            ))}

            {labels.map((l) => (
              <g key={l.id}>
                <line x1={x(last) + 8} x2={x(last) + 18} y1={l.ly} y2={l.ly}
                  stroke={l.colour} strokeWidth="3" strokeLinecap="round" />
                <text className="chart-label" x={x(last) + 23} y={l.ly + 4}>{clip(l.name)}</text>
              </g>
            ))}

            {hover != null && (
              <g>
                <line className="chart-cross" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={HEIGHT - PAD.b} />
                {visible.map((s) => (
                  <circle key={s.player.player_id}
                    cx={x(hover)} cy={y(s.points[hover].total)} r="3.5"
                    fill={s.player.colour_hex} stroke="#fff" strokeWidth="1.5" />
                ))}
              </g>
            )}
          </svg>

          {hover != null && (
            <div
              className="chart-tip"
              style={{
                left: x(hover),
                transform: x(hover) > width / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
              }}
            >
              <strong>{hover === 0 ? 'Before episode 1' : `After episode ${hover}`}</strong>
              {[...visible]
                .sort((a, b) => b.points[hover].total - a.points[hover].total)
                .map((s) => (
                  <span key={s.player.player_id} className="chart-tip-row">
                    <span className="chip-dash" style={{ background: s.player.colour_hex }} />
                    {s.player.display_name}
                    <b>{s.points[hover].total}</b>
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="chart-legend">
        {series.map((s) => {
          const state = stateOf(s)
          return (
            <button
              key={s.player.player_id}
              type="button"
              className={`chip ${state}`}
              onClick={() => onCycle(s.player.player_id)}
              aria-label={`${s.player.display_name}: line ${WORD[state]}. Activate for ${WORD[NEXT[state]]}.`}
            >
              <span className="chip-dash" style={{ background: s.player.colour_hex }} />
              <span className="chip-name">{s.player.display_name}</span>
            </button>
          )
        })}
      </div>

      <p className="small muted chart-note">
        Tap a name, or a row in the table above, to bring its line forward, push
        it back or hide it.
        {hasBonus && ' Series bonuses aren’t on the lines — they belong to the series rather than to any one episode — so the totals in the table run ahead of where the lines finish.'}
      </p>

      {/* The fallback for anyone the colours fail, and it is not optional
          (DESIGN §6). Same numbers, no hues, no interaction. */}
      <details className="chart-table">
        <summary>Show the numbers</summary>
        <div className="scroll-x">
          <table className="numbers">
            <thead>
              <tr>
                <th scope="col">Player</th>
                {Array.from({ length: last }, (_, i) => i + 1).map((n) => (
                  <th key={n} scope="col">Ep {n}</th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {series.map((s) => (
                <tr key={s.player.player_id}>
                  <th scope="row">{s.player.display_name}</th>
                  {s.points.slice(1).map((p) => <td key={p.n}>{p.total}</td>)}
                  <td className="strong">{s.player.total_points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Running totals after each episode.
          {hasBonus && ' The last column includes series bonuses, which have no episode of their own.'}
        </p>
      </details>

      <HowToRead>
        <Note term="One line each">
          A running total. Every line starts at zero before
          episode 1.
        </Note>
        <Note term="Faded lines">
          By default, the chart shows all player lines as muted, except the top three and you. Click on a name button to highlight, mute or hide.
        </Note>
        <Note term="Bake guesses">
          On the lines, in the week the bake came up.
        </Note>
        <Note term="Show the numbers">
          The same figures written out.
        </Note>
      </HowToRead>
    </Panel>
  )
}

const WORD = { full: 'shown', muted: 'faded', hidden: 'hidden' }
const NEXT = { full: 'muted', muted: 'hidden', hidden: 'full' }

/**
 * The container's width, watched. The SVG is a fixed pixel width so that ten
 * episodes stay legible on a phone and scroll, and that means the "or fill the
 * space, if there is more of it" half has to be measured.
 *
 * ResizeObserver fires once when it starts observing, which is what gives the
 * first measurement — a synchronous read here would be a setState inside an
 * effect, which React's rules reject and which would cost a second render.
 */
function useElementWidth(ref) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) setWidth(box.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])

  return width
}

/** Ticks at round numbers, always including zero, and never more than six. */
function scaleFor(series) {
  const values = series.flatMap((s) => s.points.map((p) => p.total))
  const rawLo = Math.min(0, ...values)
  const rawHi = Math.max(4, ...values)
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => (rawHi - rawLo) / s <= 5) ?? 200
  const lo = Math.floor(rawLo / step) * step
  const hi = Math.ceil(rawHi / step) * step

  const ticks = []
  for (let v = lo; v <= hi; v += step) ticks.push(v)
  return { ticks, lo, hi: hi === lo ? lo + step : hi }
}

/**
 * Direct labels can't overlap, and two players on the same points is the
 * ordinary case rather than the awkward one. Push down from the top, then back
 * up off the bottom, so a crowd stays inside the chart.
 */
function spread(items, min, max, gap) {
  const sorted = [...items].sort((a, b) => a.y - b.y)

  let floor = min
  for (const item of sorted) {
    item.ly = Math.max(item.y, floor)
    floor = item.ly + gap
  }

  let ceiling = max
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    sorted[i].ly = Math.min(sorted[i].ly, ceiling)
    ceiling = sorted[i].ly - gap
  }

  return sorted
}

/** The right margin holds about eleven characters. */
function clip(name) {
  return name.length > 11 ? `${name.slice(0, 10)}…` : name
}
