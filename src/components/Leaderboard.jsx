import { useLayoutEffect, useRef } from 'react'
import { Panel } from './Panel.jsx'
import { Avatar } from './Avatar.jsx'
import { positionLabel, signed } from '../lib/scores.js'
import { usePopKey } from '../lib/usePopKey.js'

/**
 * The league table. The thing people actually open this page for, so it sits at
 * the top of the stack — TECH_PLAN §5 calls it "the default view on a narrow
 * screen", and a phone on a sofa is the real device.
 *
 * Every number here comes from v_standings and v_episode_scores. The only thing
 * worked out in the browser is the movement arrow, which is about ordering
 * rather than points (scores.js).
 *
 * Each row is a button, because the row is also the chart's control: tapping it
 * cycles that player's line between full, muted and hidden (DESIGN §6).
 *
 * v_standings ranks with rank(), so ties share a position and the sequence
 * skips — 1, 1, 3. That is shown as it is, with "joint 2nd" spelled out under
 * the name so two people both reading "2nd" doesn't look like a bug. RULES §6's
 * tiebreak is applied by a human at the end of the series.
 */
export function Leaderboard({ standings, scores, episode, states, onCycle, movement, meId }) {
  const listRef = useFlipRows()

  if (!standings.length) {
    return (
      <Panel head="The table">
        <p className="muted">No players in this league yet.</p>
      </Panel>
    )
  }

  const jointAt = new Set(
    standings
      .map((r) => r.position)
      .filter((p, i, all) => all.indexOf(p) !== i)
  )

  return (
    <Panel head="The table">
      <div className="lb" ref={listRef}>
        {standings.map((row) => (
          <Row
            key={row.player_id}
            row={row}
            joint={jointAt.has(row.position)}
            week={scores.find((s) => s.player_id === row.player_id && s.episode_id === episode?.id) ?? null}
            movement={movement[row.player_id] ?? null}
            state={states[row.player_id] ?? 'muted'}
            onCycle={onCycle}
            isMe={row.player_id === meId}
          />
        ))}
      </div>
    </Panel>
  )
}

function Row({ row, joint, week, movement, state, onCycle, isMe }) {
  const pops = usePopKey(row.total_points)
  const place = positionLabel(row.position, joint)

  return (
    <button
      type="button"
      className={`lb-row line-${state}${isMe ? ' me' : ''}`}
      data-key={row.player_id}
      onClick={() => onCycle(row.player_id)}
      aria-label={
        `${row.display_name}, ${place}, ${row.total_points} points. ` +
        `Chart line ${WORD[state]}. Activate for ${WORD[NEXT[state]]}.`
      }
    >
      <span className="lb-pos">
        {joint && <span className="lb-joint" aria-hidden="true">=</span>}
        {row.position}
      </span>

      <Avatar name={row.display_name} colour={row.colour_hex} size={34} />

      <span className="lb-name">
        <span className="lb-who">
          {/* The ellipsis belongs to the name alone. With the tag inside it, a
              long name truncates through the tag and leaves a clipped scrap of
              colour with no word in it. */}
          <span className="lb-nm">{row.display_name}</span>
          {isMe && <span className="tag">You</span>}
        </span>
        <span className="lb-sub small muted">
          {/* The dash is the chart-line swatch: it says which line is this
              player's, and how loudly it is currently drawn. */}
          <span className="chip-dash" style={{ background: row.colour_hex }} />
          {place}
          <Movement movement={movement} />
        </span>
      </span>

      <span className="lb-pts">
        <span key={pops} className={`score-number lb-total${pops > 0 ? ' popped' : ''}`}>
          {row.total_points}
        </span>
        <span className="lb-week small muted">
          {week ? `${signed(week.points)} this week` : 'no entry'}
        </span>
      </span>
    </button>
  )
}

/** An arrow is never on its own — the word carries it (DESIGN §5). */
function Movement({ movement }) {
  if (movement == null) return null
  if (movement > 0) return <> · <span className="up"><span aria-hidden="true">▲</span> up {movement}</span></>
  if (movement < 0) return <> · <span className="down"><span aria-hidden="true">▼</span> down {-movement}</span></>
  return <> · holding</>
}

const WORD = { full: 'shown', muted: 'faded', hidden: 'hidden' }
const NEXT = { full: 'muted', muted: 'hidden', hidden: 'full' }

/**
 * A leaderboard reorder is a 300ms position transition and never a fade
 * (DESIGN §10) — the whole point is watching somebody move past somebody else,
 * and a cross-fade destroys exactly that.
 *
 * FLIP: after React has put the rows in their new order but before the browser
 * paints, each row that has moved is translated back to where it was and then
 * released, so the transition in styles.css carries it to its new place. It
 * measures rather than assuming a row height, so a name that wraps on a narrow
 * phone doesn't break it.
 *
 * No state is set here — the transform is written straight to the node, which
 * is the one case where touching the DOM is the simple answer rather than the
 * clever one. `prefers-reduced-motion` kills the transition in styles.css, and
 * the rows then simply appear in their new order, which is correct.
 *
 * The hook owns the ref and hands it back rather than taking one: writing to a
 * node reached through a ref that arrived as an argument is a mutation of a
 * hook's argument, which React's rules reject.
 */
function useFlipRows() {
  const ref = useRef(null)
  const seen = useRef(new Map())

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const next = new Map()
    const moved = []

    for (const child of el.children) {
      const key = child.dataset.key
      // offsetTop, not getBoundingClientRect: the second is relative to the
      // viewport, so scrolling the page between two polls would look exactly
      // like every row moving at once, and the whole table would slide.
      const top = child.offsetTop
      const before = seen.current.get(key)
      next.set(key, top)

      if (before != null && Math.abs(before - top) > 0.5) {
        child.style.transition = 'none'
        child.style.transform = `translateY(${before - top}px)`
        moved.push(child)
      }
    }

    seen.current = next
    if (!moved.length) return

    const frame = requestAnimationFrame(() => {
      for (const child of moved) {
        child.style.transition = ''
        child.style.transform = ''
      }
    })
    return () => cancelAnimationFrame(frame)
  })

  return ref
}
