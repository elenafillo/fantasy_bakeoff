import { useState, useEffect, useCallback } from 'react'
import { Panel } from '../components/Panel.jsx'
import { Avatar } from '../components/Avatar.jsx'
import { Scorecard } from '../components/Scorecard.jsx'
import { storedCode, rememberCode, rememberWho, forgetCode, playerPost } from '../lib/playerApi.js'
import { useCountdown } from '../lib/useCountdown.js'
import { useRefreshOnFocus } from '../lib/useRefreshOnFocus.js'
import { fetchScoreboard, positionLabel } from '../lib/scores.js'

/**
 * The player panel. Log in with a two-word code, make this week's picks,
 * Confirm — and once results start landing, see how you did.
 *
 * Nothing here is a rule. The countdown, the disabled buttons and the LATE
 * warning are conveniences — api/player.js re-derives every one of them from
 * the server clock, because a browser can lie about the time and a disabled
 * button can be re-enabled from devtools. Every point on the scorecard likewise
 * arrives already worked out, from the views in supabase/views.sql.
 */
export default function Play() {
  const [code, setCode] = useState(() => storedCode())
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!code) return
    // Cancellation matters here: signing out and back in with a different code
    // can leave an earlier request in flight, and without this the slower of
    // the two wins and shows the wrong player's panel.
    let cancelled = false
    playerPost('state', code)
      .then((next) => {
        if (cancelled) return
        // Two public facts, cached so the dashboard can open on this player's
        // league with their row marked without an /api/player call of its own
        // (playerApi.js). Written on every state call, so it follows the GM
        // moving somebody between leagues.
        rememberWho({ playerId: next.player.id, leagueSlug: next.league.slug })
        setState(next)
        setError(null)
      })
      .catch((err) => { if (!cancelled) { setError(err.message); setState(null) } })
    return () => { cancelled = true }
  }, [code])

  function signOut() {
    forgetCode()
    setCode(null)
    setState(null)
    setError(null)
  }

  if (!code || (!state && error)) {
    return (
      <Login
        error={error}
        onIn={(c) => { setError(null); rememberCode(c); setCode(c) }}
      />
    )
  }

  if (!state) return <Panel><p className="muted">Opening your panel…</p></Panel>

  return <Entry state={state} code={code} setState={setState} onOut={signOut} />
}

// ------------------------------------------------------------
// Login
// ------------------------------------------------------------

function Login({ onIn, error }) {
  const [value, setValue] = useState('')

  return (
    <Panel head="Come in">
      <h1>What&rsquo;s your code?</h1>
      <p className="muted">
        Two words, from whoever runs your league. Capitals and hyphens don&rsquo;t matter.
      </p>
      <form
        className="login"
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = value.trim()
          if (trimmed) onIn(trimmed)
        }}
      >
        <input
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="velvet crumb"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          aria-label="Your two-word code"
        />
        <button className="btn" type="submit">Let me in</button>
      </form>
      {error && <p className="notice bad" role="alert">{error}</p>}
    </Panel>
  )
}

// ------------------------------------------------------------
// The entry form
// ------------------------------------------------------------

function Entry({ state, code, setState, onOut }) {
  const {
    player, league, episode, categories, bakers, bakerNames,
    entry, editable, lockReason, wouldBe, standings, topThree, guesses,
  } = state

  // Picks are local until saved, so changing your mind is free and the server
  // hears about it once.
  const [picks, setPicks] = useState(state.picks)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [flash, setFlash] = useState(null)

  // Has the player deliberately opened an on-time entry for editing after the
  // deadline? Purely local, and deliberately NOT a rule: the server keeps one
  // lock ladder for the picks, the top three and the guesses (api/player.js),
  // and a save at 18:05 is allowed whatever this says. All it does is make the
  // 2-point path a decision instead of a stray tap — the one failure mode that
  // is nobody's fault and still costs them points.
  const [unlocked, setUnlocked] = useState(false)

  // Re-sync when the server sends a new state. Done during render rather than
  // in an effect: an effect would paint one frame of the old picks first, and
  // React's own guidance is to adjust state directly when it derives from a
  // changed prop. `state.picks` is a fresh object per response, so identity is
  // the right comparison.
  const [seenPicks, setSeenPicks] = useState(state.picks)
  if (seenPicks !== state.picks) {
    setSeenPicks(state.picks)
    setPicks(state.picks)
    setDirty(false)
  }

  // NOTE WHAT IS NOT RESET ABOVE: `unlocked`. It was, and that was a bug —
  // every response carries a fresh `state.picks` object, so confirming,
  // un-confirming or simply coming back to the tab slammed the gate shut on
  // somebody who had already said "Edit anyway". Confirm in particular is not
  // an edit and has no business changing whether the form is open.
  //
  // Nothing is lost by letting the decision stand for the visit: `guarded`
  // stops applying the moment the entry is actually stamped late, and `frozen`
  // still honours `!editable`, so 20:00 closes the form whatever this says.

  const countdown = useCountdown(episode?.deadline_at)

  // ---- the scoreboard ----
  // Read straight from the granted views with the publishable key, never
  // through /api/player: eight phones refreshing all evening then costs zero
  // Vercel invocations (TECH_PLAN §6).
  const [board, setBoard] = useState(null)
  const [boardFailed, setBoardFailed] = useState(false)
  const [reloads, setReloads] = useState(0)

  const episodeId = episode?.id
  const episodeNumber = episode?.number
  const leagueId = league?.id

  useEffect(() => {
    if (!episodeId) return
    let cancelled = false
    fetchScoreboard({ episodeId, episodeNumber, leagueId, playerId: player.id })
      .then((next) => { if (!cancelled) { setBoard(next); setBoardFailed(false) } })
      .catch((err) => {
        if (cancelled) return
        // Not swallowed: supabase.js throws rather than returning an empty
        // array precisely so that a missing view or grant cannot read as "no
        // results yet". The panel keeps working; it just says so quietly.
        console.error('[scoreboard]', err)
        setBoardFailed(true)
      })
    return () => { cancelled = true }
  }, [episodeId, episodeNumber, leagueId, player.id, reloads])

  // Refresh when the tab comes back, not on a timer — see useRefreshOnFocus.js
  // and TECH_PLAN §8.
  const refresh = useCallback(() => {
    setReloads((n) => n + 1)
    // The picks, the lock and the bingo prompt come from /api/player, and that
    // half is skipped while there are unsaved changes: a fresh `state.picks`
    // re-syncs the form (see above) and would throw the player's edits away
    // without a word. No rule rests on the skip — savePicks re-derives the lock
    // from the server clock and answers 403 if the episode has since started.
    if (dirty || busy) return
    playerPost('state', code).then(setState).catch(() => {
      // A background refresh that fails leaves what is on screen alone.
    })
  }, [dirty, busy, code, setState])

  useRefreshOnFocus(refresh)

  // The standings row from the scoreboard and the one /api/player sent are the
  // same row; preferring the fresher one keeps the total in the header and the
  // position on the scorecard from being two snapshots of different moments.
  const mine = board?.mine ?? standings
  const hasResults = (board?.results?.length ?? 0) > 0

  if (!episode) {
    return (
      <Panel head="Your panel">
        <h1>No episodes yet</h1>
        <p className="muted">The season hasn&rsquo;t been set up. Nudge the GM.</p>
      </Panel>
    )
  }

  async function send(action, extra) {
    setBusy(true)
    setError(null)
    setFlash(null)
    try {
      setState(await playerPost(action, code, { episodeId: episode.id, ...extra }))
      if (action === 'savePicks') setFlash(extra?.guesses ? 'Your guesses are in' : 'Saved')
      if (action === 'saveTopPicks') setFlash('Your top three is in')
      // A save can change the score, not just the picks: a VERY LATE entry the
      // GM opened the door for is submitted with results already in. Cheap to
      // re-read — it is a Supabase query, not a Vercel invocation.
      setReloads((n) => n + 1)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const picked = categories.filter((c) => picks[c.key]).length

  // ---- after the deadline (RULES §2.5) ----
  // Three situations, and they are genuinely different to be in. An entry row
  // with no picks in it is NOT a submission — the same definition v_penalties
  // uses — so an empty card counts as A and not as B.
  const submitted = Boolean(entry) && (entry.picks_made ?? 0) > 0
  const pastDeadline = editable && wouldBe !== 'on_time'
  const alreadyCharged = Boolean(entry) && entry.lateness !== 'on_time'
  // B, and the only one that is guarded: a card that is in on time, which one
  // careless change would turn into a penalty.
  const guarded = pastDeadline && submitted && !alreadyCharged && !unlocked

  // ---- Confirm, which now actually does something ----
  // TWO GUARDS, ONE FORM, and they are different in kind. `guarded` is the
  // clock's — it protects an on-time card from an accidental −2. This one is
  // the player's own: Confirm means "I'm done", so it locks their picks until
  // they say otherwise. Everybody assumed it already worked this way, which is
  // a reasonable thing to assume of a button labelled Confirm, and it was doing
  // nothing at all but setting a flag for the GM's list.
  //
  // Still no scoring consequence — confirming and un-confirming are free at any
  // time, because api/player.js's `confirm` deliberately does not re-stamp
  // lateness. Only a SAVE can cost you anything.
  const confirmLocked = Boolean(entry?.confirmed)

  const frozen = !editable || guarded || confirmLocked

  // Past the deadline with an on-time card, "Edit anyway" IS the un-confirm
  // route — it does both in one press. A plain Un-confirm beside it would be a
  // second door that un-confirms WITHOUT opening the form, which just looks
  // broken. Confirming while guarded is still offered: it is free, and "I'm
  // done" is a reasonable thing to say about a card you are not editing.
  const showConfirmToggle = Boolean(entry) && !dirty && !(guarded && entry.confirmed)

  return (
    <>
      <Panel>
        <div className="who">
          <Avatar name={player.display_name} colour={player.colour_hex} />
          <div>
            <strong>{player.display_name}</strong>
            <div className="small muted">
              {league.name}
              {mine ? ` · ${mine.total_points} pts · ${positionLabel(mine.position, board?.joint)}` : ''}
            </div>
          </div>
          <button className="link-btn" onClick={onOut}>Not you?</button>
        </div>
      </Panel>

      {/* Once results start landing this is what you opened the page for, so it
          goes above the form. Before that there is nothing in it but blanks, and
          it stays away entirely.

          It judges `state.picks` — what you actually submitted — and not the
          local `picks`, which is whatever you are in the middle of typing. */}
      {hasResults && (
        <Scorecard
          categories={categories}
          picks={state.picks}
          bakerNames={bakerNames}
          results={board.results}
          week={board.week}
          position={mine?.position ?? null}
          joint={board.joint}
          movement={board.movement}
        />
      )}

      <Panel head={`Episode ${episode.number}${episode.theme ? ` · ${episode.theme}` : ''}`}>
        <div className="deadline">
          <span className={`pill ${countdown.passed ? 'bad' : 'ok'}`}>
            <span className="dot" />
            {countdown.label}
          </span>
          {entry?.lateness && entry.lateness !== 'on_time' && (
            <span className="pill bad">
              <span className="dot" />
              {entry.lateness === 'late' ? 'Late' : 'Very late'} &middot; &minus;2
            </span>
          )}
          {entry?.confirmed && <span className="pill ok"><span className="dot" />Confirmed</span>}
          {entry?.is_disallowed && (
            <span className="pill bad"><span className="dot" />Disallowed by the GM</span>
          )}
        </div>

        {episode.bingo_prompt ? (
          <p className="bingo">
            <span className="eyebrow">This week&rsquo;s bingo</span>
            {episode.bingo_prompt}
          </p>
        ) : (
          <p className="small muted">The GM hasn&rsquo;t written this week&rsquo;s bingo yet.</p>
        )}

        {!editable && <p className="notice bad">{lockReason}</p>}

        {pastDeadline && (
          <DeadlineNotice
            wouldBe={wouldBe}
            submitted={submitted}
            alreadyCharged={alreadyCharged}
            guarded={guarded}
            confirmed={confirmLocked}
            busy={busy}
            /* Opens the form AND un-confirms, because a confirmed card is
               locked twice over and one press should clear both — being made to
               find a second button to undo a decision you have just explicitly
               made is the kind of thing that gets a panel sworn at. The
               un-confirm is free; only the save that follows costs anything. */
            onUnlock={() => {
              setUnlocked(true)
              if (entry?.confirmed) send('confirm', { confirmed: false })
            }}
          />
        )}

        {/* Why the picks are greyed, when it is the player's own doing rather
            than the clock's. Not shown while `guarded` — the notice above is
            already explaining that, and two explanations for one grey form is
            worse than none. */}
        {confirmLocked && editable && !guarded && (
          <p className="notice">
            Your entry is <strong>confirmed</strong>, so your picks are locked.
            Un-confirm below to change them.
            {!pastDeadline && ' Both are free before the deadline.'}
          </p>
        )}

        {bakers.length === 0 && (
          <p className="notice">The cast hasn&rsquo;t been added yet, so there&rsquo;s nobody to pick.</p>
        )}

        <div className="pickers">
          {categories.map((c) => (
            <label key={c.key} className="picker">
              <span className="picker-label">
                {c.label} <span className="muted">+{c.points}</span>
              </span>
              <select
                className="input"
                value={picks[c.key] ?? ''}
                disabled={frozen || busy || bakers.length === 0}
                onChange={(e) => {
                  setPicks({ ...picks, [c.key]: e.target.value || null })
                  setDirty(true)
                }}
              >
                <option value="">— nobody yet —</option>
                {bakers.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <p className="small muted">
          {picked} of {categories.length} chosen. An incomplete entry still scores
          for whatever you did fill in.
        </p>

        {error && <p className="notice bad" role="alert">{error}</p>}
        {flash && <p className="notice ok" role="status">{flash}</p>}

        {editable && (
          <div className="actions">
            <button className="btn" disabled={busy || !dirty} onClick={() => send('savePicks', { picks })}>
              {dirty ? 'Save picks' : 'Saved'}
            </button>

            {showConfirmToggle && (
              <button
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => send('confirm', { confirmed: !entry.confirmed })}
              >
                {entry.confirmed ? 'Un-confirm' : 'Confirm entry'}
              </button>
            )}
          </div>
        )}

        {dirty && <p className="small muted">Unsaved changes.</p>}

        {boardFailed && (
          <p className="small muted">
            Couldn&rsquo;t load this week&rsquo;s scores just now. Your picks are safe.
          </p>
        )}
      </Panel>

      {/* Both once-per-series items sit below the weekly picks, which are the
          reason people opened the page. The guesses come first of the two
          because they shut first — they lock with episode 1, where the top
          three does not even open until episode 1 is done, so the two are never
          both live on the same visit. */}
      <BakeGuess
        guesses={guesses}
        busy={busy}
        /* Sent WITH the week's picks, not on their own. savePicks stamps the
           entry's lateness from the server clock on every call, so a request
           carrying only guesses would mark this week's picks late for an edit
           that was not about them. One request, one submission, one stamp. */
        onSave={(typed) => send('savePicks', { picks, guesses: typed })}
      />

      <TopThree
        topThree={topThree}
        bakers={bakers}
        bakerNames={bakerNames}
        busy={busy}
        onSave={(bakerIds) => send('saveTopPicks', { bakerIds })}
      />
    </>
  )
}

// ------------------------------------------------------------
// After the deadline — RULES §2.5
// ------------------------------------------------------------
/**
 * What 18:00 means once it has gone, which depends entirely on what you have
 * already done about it. Three situations, one fee.
 *
 *   A  nothing in yet      you can still submit; it costs 2 points
 *   B  a card in, on time  editing it costs 2 points
 *   C  already late        the 2 is spent; editing is free until it airs
 *
 * B IS THE ONE THIS EXISTS FOR. Saving is a deliberate act, but changing a
 * select is not, and api/player.js re-stamps lateness on every save — so before
 * this, one stray tap on a card that was in at 17:42 quietly cost 2 points.
 * Hence the form is disabled until "Edit anyway" is pressed.
 *
 * It is NOT a lock. The server allows the save either way, and deliberately: it
 * keeps a single lock ladder across the picks, the top three and the guesses,
 * and adding a per-player "has submitted" rule to it would mean three ladders
 * that can drift. This is interaction design standing in for a rule, which is
 * the right place for it — the price is real, the accident is not.
 *
 * THE SECOND GUARD IS THE PLAYER'S OWN: a confirmed entry has its picks locked
 * too (see `confirmLocked` above). Where both are on, "Edit anyway" clears both
 * in one press — it un-confirms as well as opening the form — because having to
 * hunt for a second button to undo a decision you just made is how a panel gets
 * sworn at. Un-confirming is free; only the save that follows costs anything.
 *
 * C is worth saying out loud because the fee is flat: having missed the
 * deadline, nothing further is lost by carrying on right up to the hard lock at
 * 20:00, which is exactly the incentive RULES §2.5 is built around.
 */
function DeadlineNotice({ wouldBe, submitted, alreadyCharged, guarded, confirmed, busy, onUnlock }) {
  const veryLate = wouldBe === 'very_late'
  const flag = veryLate ? 'VERY LATE' : 'LATE'

  if (alreadyCharged) {
    return (
      <p className="notice">
        Your entry is marked <span className="flag">{flag}</span>, and the{' '}
        <strong>&minus;2</strong> has already been applied. You can change it up to
        the episode&rsquo;s start time at no extra cost.
      </p>
    )
  }

  if (!submitted) {
    return (
      <p className="notice">
        {veryLate
          ? 'The episode has started. The GM opened this for you, so whatever you save '
          : 'The deadline has passed. You can still submit — whatever you save '}
        is marked <span className="flag">{flag}</span> and costs you{' '}
        <strong>2 points</strong>.
      </p>
    )
  }

  return (
    <p className="notice">
      <strong>Your entry is in, on time.</strong> Changing it now marks it{' '}
      <span className="flag">{flag}</span> and costs you <strong>2 points</strong>.
      {confirmed && ' Editing will un-confirm it too.'}
      {guarded && (
        <>
          {' '}
          <button className="link-btn" disabled={busy} onClick={onUnlock}>
            Edit anyway (&minus;2)
          </button>
        </>
      )}
    </p>
  )
}

// ------------------------------------------------------------
// The bake guess — RULES §6
// ------------------------------------------------------------
/**
 * Two bakes, named once, before episode 1 has aired.
 *
 * The mirror image of the top three: that one opens after episode 1 because it
 * needs you to have watched everyone bake, and this one shuts before episode 1
 * because it needs you to have watched nothing. A teaser can only spoil the
 * next episode, so a commitment made before any of them cannot be spoiled at
 * all.
 *
 * Everything here is presentation. The window, the lateness ladder and the lock
 * are episode 1's, computed in api/player.js by the same `lockState` the weekly
 * picks use — `guesses.editable` only decides whether this is a form or a
 * receipt, and the server decides again on save.
 */
function BakeGuess({ guesses, busy, onSave }) {
  const [typed, setTyped] = useState(() => guesses.slots.map((g) => g.text))

  // Re-sync on a fresh server state, the same way the weekly picks and the top
  // three do.
  const [seen, setSeen] = useState(guesses.slots)
  if (seen !== guesses.slots) {
    setSeen(guesses.slots)
    setTyped(guesses.slots.map((g) => g.text))
  }

  // No episode 1, so no season worth speaking of. Nothing to say at all.
  if (!guesses.open) return null

  const same = typed.every((t, i) => t.trim() === guesses.slots[i].text)
  const anything = typed.some((t) => t.trim() !== '')

  return (
    <Panel head="The bake guess">
      <h2 className="th-head">Two bakes, for the whole series</h2>
      <p className="small muted">
        Name two things you think will come up — a bake, an ingredient, a
        technique. <strong>+5</strong> if you were the only one who said it,{' '}
        <strong>+2</strong> if exactly two of you did, nothing if three or more
        did. It pays the week it appears, once.
      </p>

      {!guesses.editable ? (
        <>
          <p className="notice">{guesses.reason ?? 'Locked in.'}</p>
          {guesses.slots.some((g) => g.text) ? (
            <ul className="guess-receipt">
              {guesses.slots.filter((g) => g.text).map((g) => (
                <li key={g.slot} className={g.isDisallowed ? 'struck' : ''}>
                  <span className="guess-word">{g.text}</span>
                  {g.unifiedTo && (
                    <span className="small muted"> · counted as “{g.unifiedTo}”</span>
                  )}
                  <span className="guess-outcome small">
                    {g.isDisallowed
                      ? 'Struck out by the GM'
                      : g.hitEpisode == null
                        ? 'Still to come up'
                        : g.points > 0
                          ? `Came up in episode ${g.hitEpisode} · +${g.points}`
                          /* It came up and paid nothing, which only happens one
                             way: too many people said it. Worth saying, because
                             otherwise a hit that scored zero reads as a bug. */
                          : `Came up in episode ${g.hitEpisode} · too many of you said it`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">
              You didn&rsquo;t make a guess, so there are no bake points to come.
            </p>
          )}
        </>
      ) : (
        <>
          {guesses.wouldBe !== 'on_time' && (
            <p className="notice">
              {guesses.wouldBe === 'late'
                ? 'The deadline has passed — this will be marked LATE.'
                : 'Episode 1 has started. The GM opened this for you, so it will be marked VERY LATE.'}
            </p>
          )}

          <div className="pickers">
            {guesses.slots.map((g, i) => (
              <label key={g.slot} className="picker">
                <span className="picker-label">Guess {g.slot}</span>
                <input
                  className="input"
                  value={typed[i]}
                  maxLength={guesses.maxLength}
                  disabled={busy}
                  placeholder={i === 0 ? 'madeleine' : 'croquembouche'}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck="false"
                  onChange={(e) => {
                    const next = [...typed]
                    next[i] = e.target.value
                    setTyped(next)
                  }}
                />
              </label>
            ))}
          </div>

          <p className="small muted">
            {/* The same clock as the panel above — the guesses lock with
                episode 1's picks, and the window is only ever open while
                episode 1 is the current one. A second countdown here would
                only invite the question of which one counts. */}
            Locks with episode 1&rsquo;s picks, and <strong>no changes after
            that</strong> — everyone&rsquo;s guesses go public at the same
            moment.
          </p>

          <div className="actions">
            <button
              className="btn"
              disabled={busy || same || !anything}
              onClick={() => onSave(typed)}
            >
              {same && anything ? 'Saved' : 'Save my guesses'}
            </button>
          </div>
        </>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------
// The top three — RULES §5
// ------------------------------------------------------------
/**
 * Once per series: pick three bakers to reach the final, after you have seen
 * everyone bake once. No order, no swaps, ever.
 *
 * The window and the lateness ladder are episode 2's, computed server-side in
 * api/player.js by the same `lockState` the weekly picks use — so everything
 * here is presentation. `topThree.editable` decides whether this is a form or a
 * receipt; the server decides again on save.
 *
 * Chosen bakers are a SET, not three ranked slots. Three selects would have
 * implied an order that RULES §5 explicitly does not have, and would have made
 * "you cannot pick the same person twice" a rule to explain rather than one the
 * interface makes unavailable.
 */
function TopThree({ topThree, bakers, bakerNames, busy, onSave }) {
  const [chosen, setChosen] = useState(topThree.picks)

  // Re-sync on a fresh server state, the same way the weekly picks do.
  const [seen, setSeen] = useState(topThree.picks)
  if (seen !== topThree.picks) {
    setSeen(topThree.picks)
    setChosen(topThree.picks)
  }

  // Nothing to say yet — usually because episode 1 is still to come.
  if (!topThree.open) {
    if (!topThree.reason) return null
    return (
      <Panel head="Your top three">
        <p className="muted">{topThree.reason}</p>
        <p className="small muted">
          Three bakers to reach the final. {topThree.count === 3 ? '+3' : ''} each if they
          do, +6 more if one of them wins it.
        </p>
      </Panel>
    )
  }

  const full = chosen.length === topThree.count
  const same =
    chosen.length === topThree.picks.length &&
    chosen.every((id) => topThree.picks.includes(id))

  function toggle(id) {
    setChosen((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        // Silently ignoring the fourth tap would look broken, so the buttons
        // are disabled at three instead and the count below says why.
        : prev.length >= topThree.count ? prev : [...prev, id]
    )
  }

  return (
    <Panel head="Your top three">
      <h2 className="th-head">Three bakers, for the whole series</h2>
      <p className="small muted">
        +3 for each one who reaches the final, and +6 more if one of them wins it.
        In no particular order — and <strong>no swaps later</strong>, even if one
        goes home.
      </p>

      {!topThree.editable ? (
        <>
          <p className="notice">{topThree.reason ?? 'Locked in.'}</p>
          {topThree.picks.length > 0 ? (
            <ul className="th-locked">
              {topThree.picks.map((id) => (
                <li key={id}>{bakerNames[id] ?? 'Unknown baker'}</li>
              ))}
            </ul>
          ) : (
            <p className="small muted">
              You didn&rsquo;t pick a top three, so there are no series bonuses to come.
            </p>
          )}
        </>
      ) : (
        <>
          {topThree.wouldBe !== 'on_time' && (
            <p className="notice">
              {topThree.wouldBe === 'late'
                ? 'The deadline has passed — this will be marked LATE.'
                : 'The episode has started. The GM opened this for you, so it will be marked VERY LATE.'}
            </p>
          )}

          <ul className="th-grid">
            {bakers.map((b) => {
              const on = chosen.includes(b.id)
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    className={`th-chip ${on ? 'on' : ''}`}
                    aria-pressed={on}
                    disabled={busy || (full && !on)}
                    onClick={() => toggle(b.id)}
                  >
                    {b.name}
                  </button>
                </li>
              )
            })}
          </ul>

          <p className="small muted">
            {chosen.length} of {topThree.count} chosen.
            {' '}
            {/* The deadline is episode 2's, and the window is only ever open
                while episode 2 is the current one — so this always IS the same
                clock as the panel above, and a second countdown ticking beside
                the first would only invite the question of which one counts. */}
            Locks with this week&rsquo;s picks.
          </p>

          <div className="actions">
            <button className="btn" disabled={busy || !full || same} onClick={() => onSave(chosen)}>
              {same && full ? 'Saved' : 'Save my three'}
            </button>
          </div>
        </>
      )}
    </Panel>
  )
}
