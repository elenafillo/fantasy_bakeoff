// ============================================================
// Guesses — the bake guess, unified and ticked
// ============================================================
// RULES §6. Two jobs, and they happen at different times:
//
//   ONCE, as soon as episode 1's deadline passes:
//     unify the formatting, so "Madeleines" and "madeleine" are one guess. The
//     guesses are locked by then, so nobody is still typing. They are also
//     public by then — the board opens on the same clock — but the board shows
//     what people TYPED and nothing ever edits that, so no word changes under
//     anybody. Unifying moves points, and no points can land until a guess is
//     ticked. Do it before the first tick and it costs nobody anything.
//
//   EVERY WEEK, while the episode airs:
//     tick whatever came up. That is recording a FACT, not awarding a score —
//     the same shape as a result. The 5/2/0 tiers live in v_guess_scores, so
//     nothing in this file adds up a point.
//
// The weekly job shrinks as the series runs: a guess pays once, so a hit
// resolves it and it drops to the bottom of the list. Week 1 is a scan of every
// distinct guess; by week 6 it is a handful.

import { useState } from 'react'
import { Panel } from '../../components/Panel.jsx'
import { Avatar } from '../../components/Avatar.jsx'

export function GuessesTab({ state, send, busy }) {
  const { guesses, episode } = state

  // Before episode 1's deadline the GM sees a count and not one word of what
  // anybody wrote — api/gm.js withholds it, because the GM plays too and has
  // two guesses of their own still to make. Same rule as the Entries tab's
  // pick counts, at the same end of the wire.
  if (!guesses.visible) {
    return (
      <Panel head="The bake guess">
        <h2>{guesses.submitted} of {guesses.players} in</h2>
        <p className="muted">
          Everyone names two bakes before episode 1. You cannot read them yet —
          neither can anyone else, and you have two of your own to make.
        </p>
        <p className="small muted">
          {guesses.locksAt
            ? 'They appear here the moment episode 1’s deadline passes — two hours before the league sees them, when the episode airs. That gap is your window to tidy the spellings, so use it before you start ticking.'
            : 'Episode 1 has no deadline yet, so nothing has locked. Set its air date on the Episodes tab.'}
        </p>
      </Panel>
    )
  }

  if (guesses.keys.length === 0) {
    return (
      <Panel head="The bake guess">
        <h2>Nobody guessed</h2>
        <p className="muted">
          The deadline has passed and no one named a bake, so there is nothing
          to tick this series.
        </p>
      </Panel>
    )
  }

  const open = guesses.keys.filter((k) => !k.hit_episode_id).length

  return (
    <Panel head="The bake guess">
      <h2>{open} still to come up</h2>
      <p className="small muted">
        Tick a guess when it comes up as the title of a signature, technical or
        showstopper. A guess pays <strong>once</strong> — ticking it resolves it
        for the series and it drops to the bottom.
      </p>
      <p className="small muted">
        Editing a guess changes <strong>what it is scored as</strong>, never what
        the player wrote. Two people on one wording is +2 each where one alone is
        +5, so tidy the spellings <em>before</em> you start ticking.
      </p>

      <div className="roster">
        {guesses.keys.map((row) => (
          <GuessRow key={row.key} row={row} episode={episode} busy={busy} send={send} />
        ))}
      </div>

      {guesses.orphans.length > 0 && (
        <>
          <hr className="rule" />
          <h3 className="rules-h">Ticked, but nobody holds it</h3>
          <p className="small muted">
            These came up and were ticked, but the wording was changed
            afterwards, so they now pay nobody. Untick them, or re-tick the
            wording people actually hold.
          </p>
          <div className="roster">
            {guesses.orphans.map((o) => (
              <div key={o.key} className="roster-row gone">
                <div className="roster-who">
                  <strong>{o.key}</strong>
                  <div className="small muted">
                    Ticked in episode {o.episode_number ?? '?'}
                  </div>
                </div>
                <div className="roster-actions">
                  <button
                    className="btn-mini"
                    disabled={busy}
                    onClick={() => send('setGuessHit', { guessKey: o.key, hit: false })}
                  >
                    Untick
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------

/**
 * One canonical guess, and everybody holding it.
 *
 * Grouped by the key rather than listed per player, because the weekly question
 * is "did this come up?" and the answer covers every holder at once. Which is
 * also the shape of the data: one `guess_hits` row per key, for the season.
 */
function GuessRow({ row, episode, busy, send }) {
  const hit = Boolean(row.hit_episode_id)
  const thisWeek = row.hit_episode_id === episode.id

  return (
    <div className={`roster-row ${hit ? 'gone' : ''}`}>
      <div className="roster-who">
        <div>
          <strong>{row.key}</strong>
          <div className="deadline">
            {hit ? (
              <span className="pill ok">
                <span className="dot" />
                Came up in episode {row.hit_episode_number ?? '?'}
              </span>
            ) : (
              <span className="pill">
                <span className="dot" />
                {row.holders.length} holding it
              </span>
            )}
          </div>
        </div>
      </div>

      <ul className="guess-holders">
        {row.holders.map((h) => (
          <Holder key={h.id} holder={h} busy={busy} send={send} />
        ))}
      </ul>

      <div className="roster-actions">
        {hit && !thisWeek ? (
          // Already resolved, in another week. Re-ticking MOVES it rather than
          // paying twice — the season/key unique constraint sees to that — so
          // the button says what it will do rather than pretending to add one.
          <button
            className="btn-mini"
            disabled={busy}
            onClick={() => send('setGuessHit', { guessKey: row.key, hit: true })}
          >
            Move to episode {episode.number}
          </button>
        ) : (
          <button
            className="btn-mini"
            disabled={busy}
            onClick={() => send('setGuessHit', { guessKey: row.key, hit: !hit })}
          >
            {hit ? 'Untick' : `Came up in ep ${episode.number}`}
          </button>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------

/**
 * One player's holding of a guess: what they typed, what it is being scored as,
 * and what it is worth to them.
 *
 * `points` comes from v_guess_scores and is never worked out here. It is per
 * LEAGUE — holders are counted inside a league, so the same guess can be worth
 * +5 to one person and +2 to another if they play in different leagues, and
 * that is correct rather than a glitch.
 */
function Holder({ holder, busy, send }) {
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState(holder.guess_text)

  function open() {
    // Seeded with what they TYPED, not with the current key: the GM is almost
    // always tidying an original rather than editing an earlier tidy-up.
    setKey(holder.guess_text)
    setEditing(true)
  }

  return (
    <li className={`guess-holder ${holder.is_disallowed ? 'struck' : ''}`}>
      <div className="guess-holder-who">
        <Avatar name={holder.display_name} colour={holder.colour_hex} size={22} />
        <span className="guess-holder-name">{holder.display_name}</span>
        {holder.is_late && <span className="flag">Late</span>}
        {holder.points != null && (
          <span className="guess-holder-pts">
            {holder.points > 0 ? `+${holder.points}` : '0'}
          </span>
        )}
      </div>

      {/* What they wrote, always shown, never editable — by anyone. The key is
          a second column beside it, which is what makes the tidy-up auditable
          rather than something that happened to them. */}
      <div className="small muted guess-holder-text">
        wrote &ldquo;{holder.guess_text}&rdquo;
      </div>

      {editing ? (
        <div className="stack">
          <label className="field">
            <span className="picker-label">Scored as</span>
            <input
              className="input"
              value={key}
              autoCapitalize="none"
              spellCheck="false"
              onChange={(e) => setKey(e.target.value)}
            />
            <span className="small muted">
              Matching somebody else&rsquo;s wording joins them together, which
              moves both from +5 to +2. Matching this player&rsquo;s other guess
              is refused.
            </span>
          </label>
          <div className="actions">
            <button
              className="btn"
              disabled={busy || !key.trim()}
              onClick={() => {
                setEditing(false)
                send('setGuess', { guessId: holder.id, guess_key: key })
              }}
            >
              Save
            </button>
            <button className="btn btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="roster-actions">
          <button className="btn-mini" disabled={busy} onClick={open}>Reword</button>
          <button
            className="btn-mini"
            disabled={busy}
            onClick={() =>
              send('setGuess', { guessId: holder.id, is_disallowed: !holder.is_disallowed })
            }
          >
            {/* RULES §6 leaves a VERY LATE guesser to the GM's judgement rather
                than to code: somebody let in after the episode started can see
                everyone else's guesses, and could pick one nobody took. This is
                that judgement. It takes the guess out of the holders count as
                well as the payout. */}
            {holder.is_disallowed ? 'Allow' : 'Strike out'}
          </button>
        </div>
      )}
    </li>
  )
}
