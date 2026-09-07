import { useState } from 'react'
import { Panel } from './Panel.jsx'
import { nameList, positionLabel, verdictFor } from '../lib/scores.js'

/**
 * How a week went: every pick ticked or crossed, what the answer actually was,
 * the week's points, and which way you moved.
 *
 * Every number rendered here arrives already worked out, from v_episode_scores
 * and v_standings. The component adds nothing up (see src/lib/scores.js for
 * why). Its own contribution is the tick or the cross, and keeping the four
 * result states visibly apart.
 *
 * Props are plain data on purpose, with no fetching of its own: the same shape
 * feeds the dashboard's prediction wall in phase 5.
 */
export function Scorecard({ categories, picks, bakerNames, results, week, position, joint, movement }) {
  const label = positionLabel(position, joint)

  return (
    <Panel head="How you did">
      <div className="score-head">
        <Big points={week?.points ?? null} />
        <div className="score-aside">
          <strong className="score-move">
            <Movement movement={movement} label={label} />
          </strong>
          <div className="small muted">
            {week
              ? `${week.correct_count} of ${week.picks_made} pick${week.picks_made === 1 ? '' : 's'} right`
              : 'You didn’t enter this week.'}
          </div>
        </div>
      </div>

      <div className="verdicts">
        {categories.map((c) => (
          <Verdict
            key={c.key}
            category={c}
            pick={picks[c.key] ?? null}
            bakerNames={bakerNames}
            results={results}
            // Which pick cost a point, straight from v_episode_scores. The
            // browser is told, never left to work it out — that would be a
            // second implementation of a scoring rule.
            penalty={(week?.penalties ?? []).find((p) => p.category === c.key) ?? null}
          />
        ))}
      </div>

      {/* The split is only worth showing when a penalty actually fired —
          otherwise it restates the number already set in 40px type. Both halves
          come from SQL; nothing here is added up. */}
      {week && week.penalty_points !== 0 && (
        <div className="score-sums">
          <div><span>Picks</span><span>{signed(week.pick_points)}</span></div>
          <div className="cost">
            <span>Penalties</span>
            <span>{signed(week.penalty_points)}</span>
          </div>
          <div className="total"><span>This week</span><span>{week.points}</span></div>
        </div>
      )}
    </Panel>
  )
}

/**
 * The week's points. A score change is the one moment DESIGN §10 says is worth
 * animating — 400ms with a slight overshoot — so the pop fires when the number
 * *changes* and not when the panel first opens, where it would be a flourish
 * for something nobody watched happen. Remounting on a key is what restarts the
 * animation; `prefers-reduced-motion` already kills it in styles.css.
 */
function Big({ points }) {
  const [seen, setSeen] = useState(points)
  const [pops, setPops] = useState(0)
  if (seen !== points) {
    setSeen(points)
    setPops((n) => n + 1)
  }

  return (
    <div className="score-big">
      <span key={pops} className={`score-number${pops > 0 ? ' popped' : ''}`}>
        {points ?? '—'}
      </span>
      <span className="score-unit">
        point{points === 1 || points === -1 ? '' : 's'}
        <br />this week
      </span>
    </div>
  )
}

/** An arrow is never on its own — the words carry it (DESIGN §5). */
function Movement({ movement, label }) {
  if (!label) return null
  if (movement == null) return <>{sentenceCase(label)}</>
  if (movement > 0) {
    return <><span aria-hidden="true">▲ </span>Up {movement} to {label}</>
  }
  if (movement < 0) {
    return <><span aria-hidden="true">▼ </span>Down {-movement} to {label}</>
  }
  return <>Holding {label}</>
}

/**
 * One category's verdict. The states, and why they look the way they do:
 *
 *   right      mint tint AND a tick — mint never appears instead of the tick,
 *              because colour never carries information alone (DESIGN §5)
 *   wrong      greyed out, leading with what the answer actually was. No cross
 *              and no red: a wrong pick is the ordinary outcome, it costs
 *              nothing, and it should recede so that the two rows that DO cost
 *              something can stand out
 *   nobody     hatched, 45° diagonals — settled, and paid nobody
 *   pending    plainly blank behind a stitch border. Blank and hatched must not
 *              look alike; that is the whole distinction (DESIGN §7, RULES §3)
 *
 * A penalty is not a fifth state but a layer on top: red, and explicit about
 * which pick cost the point, because "wrong" and "wrong in a way that cost you
 * a point" are genuinely different outcomes and used to look identical.
 */
function Verdict({ category, pick, bakerNames, results, penalty }) {
  const { state, winners } = verdictFor(category.key, pick, results)
  const answer = nameList(winners.map((w) => w.baker_name))
  const mine = pick ? bakerNames[pick] ?? 'someone no longer in the tent' : null

  return (
    <div className={`verdict ${state}${penalty ? ' penalised' : ''}`}>
      <span className="picker-label">
        {category.label} <span className="muted">+{category.points}</span>
      </span>

      <div className={`verdict-body${state === 'nobody' ? ' hatched' : ''}`}>
        {penalty ? (
          <span className="verdict-line">
            <span className="verdict-cost">{signed(penalty.points)}</span>
            {penaltyWording(penalty.reason, mine)}
          </span>
        ) : (
          /* A tick is the expected vocabulary for a correct pick, so that one
             state gets a mark. Nothing else does: Nobody already has the
             hatching behind the words, and the rest read as prose. */
          <span className="verdict-line">
            {state === 'right' && <><Mark glyph="✓" />Right · {answer}</>}
            {state === 'wrong' && `It was ${answer}`}
            {state === 'nobody' && 'Nobody won it'}
            {state === 'nopick' && `It was ${answer}`}
            {state === 'pending' && 'Still to come'}
          </span>
        )}

        <Detail state={state} mine={mine} answer={answer} winners={winners} penalty={penalty} />
      </div>
    </div>
  )
}

/**
 * RULES §2.3 in the second person. "They" throughout — a baker's pronouns are
 * not something the database knows or needs to.
 */
function penaltyWording(reason, mine) {
  const who = mine ?? 'your pick'
  if (reason === 'best_left') {
    return `You picked ${who} for Star Baker, and they went home.`
  }
  if (reason === 'leaving_starred') {
    return `You picked ${who} to go home, and they took Star Baker.`
  }
  // A reason this build has not met. Say what is certain rather than guess.
  return `Your pick here cost you a point.`
}

function Detail({ state, mine, answer, winners, penalty }) {
  let text = null

  if (penalty) {
    // The penalty line has already said what you picked, so this says what
    // actually happened in the category — the same job it does when wrong.
    text = answer ? `It was ${answer}.` : null
  } else if (state === 'right') {
    // Two eliminations, two handshakes, a bingo catching three people: naming
    // any one of them scores, once (RULES §3). Saying so is what stops the
    // extra names reading as a mistake.
    text = winners.length > 1 ? `Any of ${answer} would have done it.` : null
  } else if (state === 'wrong') {
    text = `You said ${mine}.`
  } else if (state === 'nobody') {
    text = mine
      ? `You said ${mine}, and it paid nobody — no points, no penalty.`
      : 'It happened to no one, so the category paid nobody.'
  } else if (state === 'nopick') {
    text = 'You didn’t pick anyone.'
  } else if (state === 'pending' && mine) {
    text = `You said ${mine}.`
  }

  return text ? <span className="verdict-detail">{text}</span> : null
}

function Mark({ glyph }) {
  return <span className="verdict-mark" aria-hidden="true">{glyph}</span>
}

/**
 * −1 reads as a penalty; +4 reads as points won. 0 is just 0.
 *
 * A real minus sign (U+2212), not a hyphen: it is the width of the plus above
 * it, which is what keeps a tabular-nums column actually lining up.
 */
function signed(n) {
  if (n == null) return '—'
  if (n > 0) return `+${n}`
  return n < 0 ? `−${Math.abs(n)}` : '0'
}

function sentenceCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
