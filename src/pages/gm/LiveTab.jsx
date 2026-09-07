// ============================================================
// Live — the episode-night screen
// ============================================================
// The only screen touched during an episode: big controls, four taps per
// result, one-handed on a sofa.

import { useState } from 'react'
import { Panel } from '../../components/Panel.jsx'
import { Confirm } from './Confirm.jsx'
import { ukTime } from './time.js'

export function LiveTab({ state, send, busy }) {
  const { episode, episodeCategories, results, bakers, entries } = state

  return (
    <>
      <Panel head={`Episode ${episode.number}${episode.theme ? ` · ${episode.theme}` : ''}`}>
        <div className="deadline">
          <span className={`pill ${episode.live_at ? 'bad' : ''}`}>
            <span className="dot" />
            {episode.live_at ? 'On air' : episode.status}
          </span>
          <span className="pill">
            <span className="dot" />
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
          </span>
          {episode.deadline_at && (
            <span className={`pill ${state.picksPublic ? 'ok' : ''}`}>
              <span className="dot" />
              {state.picksPublic ? 'Picks are public' : `Deadline ${ukTime(episode.deadline_at)}`}
            </span>
          )}
        </div>

        {!episode.deadline_at && (
          <p className="notice">
            No deadline set, so nobody can be late and picks stay private. Set the
            air date on the Episodes tab.
          </p>
        )}

        {!episode.live_at && (
          <Confirm
            label="Go live"
            confirmLabel="Yes — go live"
            note="This closes the panel for everyone who hasn't submitted. Only the Episodes tab can undo it."
            busy={busy}
            onConfirm={() => send('goLive')}
          />
        )}
      </Panel>

      <Panel>
        <h2>Who won what</h2>
        <p className="small muted">
          Nobody is an answer, not a switch — pick it the same way you pick a baker.
          Leave a category alone until you know.
        </p>

        <div className="results">
          {episodeCategories.map((c) => (
            <Category
              key={c.key}
              category={c}
              bakers={bakers}
              rows={results.filter((r) => r.category === c.key)}
              busy={busy}
              onSet={(value) => send('setCategory', { category: c.key, value })}
              // Recording who left also marks them out of the tent. That is a
              // side effect of this control, so it says so rather than leaving
              // the GM to notice next week that a picker is one baker short.
              note={c.key === 'leaving' ? eliminationNote(results, bakers, episode) : null}
            />
          ))}
        </div>
      </Panel>
    </>
  )
}

/**
 * One category, in the three states that matter:
 *
 *   no rows           — not decided yet —   still to come
 *   a voided row      — Nobody —            nothing happened, nobody scores
 *   winner rows       a baker, or several
 *
 * Not decided and Nobody are different answers and this control keeps them
 * apart: clearing a mistaken pick returns to "not decided", it does not quietly
 * void the category.
 *
 * Extra winners are their own selects. The "add" slot is local state, because
 * an empty slot is not a state the database has — only a chosen baker is sent.
 */
function Category({ category, bakers, rows, busy, onSet, note }) {
  const [adding, setAdding] = useState(false)

  const voided = rows.some((r) => r.voided)
  const winners = rows.filter((r) => !r.voided).map((r) => r.baker_id)
  const extras = winners.slice(1)

  const options = (exclude) =>
    bakers
      .filter((b) => !exclude.includes(b.id))
      .map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}{b.status === 'eliminated' ? ' (out)' : ''}
        </option>
      ))

  return (
    <div className="result">
      <span className="picker-label">
        {category.label} <span className="muted">+{category.points}</span>
      </span>

      <select
        className={`input ${voided ? 'hatched' : ''}`}
        value={voided ? 'nobody' : (winners[0] ?? '')}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value
          if (v === '') return onSet('undecided')
          if (v === 'nobody') return onSet('nobody')
          onSet([v, ...extras])
        }}
      >
        <option value="">— not decided yet —</option>
        <option value="nobody">— Nobody —</option>
        {options(extras)}
      </select>

      {extras.map((id) => (
        <div className="row" key={id}>
          <select
            className="input"
            value={id}
            disabled={busy}
            onChange={(e) => onSet(winners.map((w) => (w === id ? e.target.value : w)))}
          >
            {options(winners.filter((w) => w !== id))}
          </select>
          <button
            className="btn-mini"
            disabled={busy}
            onClick={() => onSet(winners.filter((w) => w !== id))}
          >
            Remove
          </button>
        </div>
      ))}

      {adding && (
        <div className="row">
          <select
            className="input"
            value=""
            disabled={busy}
            onChange={(e) => {
              if (!e.target.value) return
              setAdding(false)
              onSet([...winners, e.target.value])
            }}
          >
            <option value="">— and who else? —</option>
            {options(winners)}
          </select>
          <button className="btn-mini" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}

      {!adding && winners.length > 0 && (
        <button className="btn-mini" disabled={busy} onClick={() => setAdding(true)}>
          + Add another winner
        </button>
      )}

      {note && <p className="small muted">{note}</p>}
    </div>
  )
}

/**
 * What the leaving result just did to the cast. Only names bakers this
 * episode's own result marked out, which is exactly the set it would put back
 * if the answer changed — so the note and the undo describe the same thing.
 */
function eliminationNote(results, bakers, episode) {
  const out = results
    .filter((r) => r.category === 'leaving' && !r.voided)
    .map((r) => bakers.find((b) => b.id === r.baker_id))
    .filter((b) => b?.status === 'eliminated' && b.eliminated_episode === episode.number)
    .map((b) => b.name)

  if (out.length === 0) return null

  const names = out.length === 1
    ? out[0]
    : `${out.slice(0, -1).join(', ')} and ${out[out.length - 1]}`

  return `${names} ${out.length === 1 ? 'is' : 'are'} now out of the tent, ` +
    `and gone from next week's pickers. Change this answer and they go back in.`
}
