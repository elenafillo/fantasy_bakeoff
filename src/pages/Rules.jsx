import { Panel } from '../components/Panel.jsx'

/**
 * The short version of RULES.md — the points, the deadline, the penalty, the
 * top three and the weeks that don't behave (TECH_PLAN §5).
 *
 * Deliberately NOT the whole document. This is the page someone opens on a
 * phone, on the sofa, two minutes before the deadline, to settle an argument
 * about whether naming a second leaving baker pays twice. RULES.md stays the
 * long form and the place decisions get recorded; if the two ever disagree,
 * RULES.md is right and this is stale.
 *
 * Static — no fetch, no endpoint, no login. The points below are duplicated
 * from the `categories` table rather than read from it, and that is a real
 * trade: the table is config, so changing what Star Baker is worth is a row
 * update and this page would not follow. It is worth it to keep /rules
 * readable with no network at all, and the numbers have not moved since RULES
 * §2.1 was written. If they ever do, `v_categories_public` is granted and this
 * becomes a five-line fetch.
 */
export default function Rules() {
  return (
    <>
      <Panel head="How it works">
        <h1>The rules</h1>
        <p className="muted">
          Every week you name a baker in five categories. Points land <strong>as
          the episode airs</strong>, so the table moves while you watch.
        </p>

        <h2 className="rules-h">Every week</h2>
        <table className="rules-table">
          <tbody>
            <tr><th>Best Baker</th><td className="pts">+4</td><td>Who gets Star Baker</td></tr>
            <tr><th>Leaving Baker</th><td className="pts">+3</td><td>Who goes home</td></tr>
            <tr><th>Technical Winner</th><td className="pts">+2</td><td>First in the technical</td></tr>
            <tr><th>Bingo Bonus</th><td className="pts">+2</td><td>Who the GM&rsquo;s bingo event happens to</td></tr>
            <tr><th>Handshake</th><td className="pts">+2</td><td>Who gets a Hollywood handshake</td></tr>
          </tbody>
        </table>
        <p className="small muted">Thirteen points is a perfect week.</p>

        <h2 className="rules-h">The penalty</h2>
        <p>
          Reading a baker badly wrong in <em>both</em> directions costs a point:
        </p>
        <table className="rules-table">
          <tbody>
            <tr><th>You said Star Baker, they went home</th><td className="pts cost">&minus;1</td></tr>
            <tr><th>You said they&rsquo;d go home, they got Star Baker</th><td className="pts cost">&minus;1</td></tr>
          </tbody>
        </table>
        <p className="small muted">
          Both can fire in one week, so the worst possible week is &minus;2.
        </p>
      </Panel>

      <Panel head="The deadline">
        <h2 className="rules-h">18:00 Tuesday</h2>
        <p>
          UK time, the day of the episode. Change your mind as often as you like
          before then — <strong>Confirm</strong> just marks it final, and you can
          un-confirm right up to the wire. An incomplete entry still scores for
          whatever you did fill in.
        </p>

        <table className="rules-table">
          <tbody>
            <tr><th>Before 18:00</th><td>Always fine</td></tr>
            <tr><th>After the deadline, before it airs</th><td><span className="flag">LATE</span> — still allowed</td></tr>
            <tr><th>Once the episode has started</th><td><span className="flag">VERY LATE</span> — only if the GM opens the door</td></tr>
          </tbody>
        </table>

        <p className="notice">
          <strong>Everyone&rsquo;s picks go public the moment the deadline passes.</strong>{' '}
          You will need a very very good excuse for a submission post-episode.
        </p>
      </Panel>

      <Panel head="Your top three">
        <h2 className="rules-h">Three bakers, once, for the whole series</h2>
        <p>
          After episode 1 — once you&rsquo;ve seen everyone bake — you commit to
          three bakers to reach the final. In no particular order, and{' '}
          <strong>no swaps later</strong>, even after one goes home.
        </p>
        <table className="rules-table">
          <tbody>
            <tr><th>Each of your three who reaches the final</th><td className="pts">+3</td></tr>
            <tr><th>The series winner is one of your three</th><td className="pts">+6</td></tr>
          </tbody>
        </table>
        <p className="small muted">
          A perfect set is 15. The +3s land when the semi-final ends and the
          finalists are known; the +6 at the final. Picks lock with episode
          2&rsquo;s deadline, and everyone&rsquo;s three go public at the same moment.
        </p>
      </Panel>

      <Panel head="Weeks that don’t behave">
        <h2 className="rules-h">Nobody, and two of everything</h2>
        <p>
          Real episodes break the neat five-category shape. When a category
          didn&rsquo;t happen, the GM records it as <strong>Nobody</strong> — it
          pays no one, and no penalty can fire from it.
        </p>
        <ul className="rules-list">
          <li><strong>Two bakers go home?</strong> Naming either scores the full +3. Not +6 — one correct call, one prize.</li>
          <li><strong>Several handshakes, or the bingo hits several bakers?</strong> Same again: naming any of them scores once.</li>
          <li><strong>No Star Baker, no handshake, nobody leaves?</strong> That category goes to Nobody.</li>
        </ul>
      </Panel>

      <Panel head="The final">
        <h2 className="rules-h">A different card</h2>
        <p className="muted">
          Three bakers, no elimination and no Star Baker, so the final scores
          differently:
        </p>
        <table className="rules-table">
          <tbody>
            <tr><th>Winner of Bake Off</th><td className="pts">+5</td></tr>
            <tr><th>Technical Winner</th><td className="pts">+2</td></tr>
            <tr><th>Bingo Bonus</th><td className="pts">+2</td></tr>
            <tr><th>Handshake</th><td className="pts">+2</td></tr>
          </tbody>
        </table>
        <p className="small muted">
          Most points at the end of the final wins. Ties go to most correct Star
          Baker calls, then Leaving Baker, then fewest penalties, then whoever
          was consistently the most organised about submitting.
        </p>
      </Panel>

      <Panel>
        <h2 className="rules-h">Fair play</h2>
        <ul className="rules-list">
          <li>Nobody sees your picks before the deadline — <strong>including the GM</strong>, who plays too.</li>
          <li>The GM enters results after the deadline has locked their own entry, like everyone else&rsquo;s.</li>
          <li>The GM&rsquo;s call on the bingo, and on whether a category went to Nobody, is final.</li>
          <li>Spoilers from the press, leaks or the future are, obviously, out.</li>
        </ul>

        {/* The colophon. Wording and link are Elena's, and the attribution half
            is hers on purpose — it credits somebody else's game, and that is
            not a thing to guess at. Note it says UNOFFICIAL: that site states
            it is not affiliated with the programme, Channel 4 or Love
            Productions, so calling it official would be wrong twice over. */}
        <p className="colophon">
          This game is a home-made version of the unofficial{' '}
          <a href="https://fantasybakeoff.co.uk/" target="_blank" rel="noreferrer noopener">
            Fantasy Bake Off
          </a>
          . Built with Claude Opus 5.
        </p>
      </Panel>
    </>
  )
}
