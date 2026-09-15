import { Panel } from '../components/Panel.jsx'

/**
 * The feedback form, twice. ONE Google Form, with the "what kind of thing is
 * this" question pre-filled from the URL — so the two buttons below are the
 * same destination with a different answer already ticked.
 *
 * Two links rather than one because the question the reader arrives with is
 * already either "this is broken" or "this could be better", and making them
 * re-state it on the form is a step that earns nothing. Only the
 * `entry.139240661` value differs; everything else is identical, so if the form
 * is ever rebuilt BOTH need replacing — a rebuilt form gets a new id and the
 * old links die silently, landing on a Google 404 rather than erroring here.
 *
 * Deliberately off-site: collecting this in the app would mean the browser's
 * first write permission to the database, and an anon insert policy is exactly
 * what views.sql exists to keep out.
 */
const BUG_FORM =
  'https://docs.google.com/forms/d/e/1FAIpQLSd2qh1fzMefQPjqXJHQuj2-6haPeEKuK3BGpicM9N3dRv8pZg/viewform?usp=pp_url&entry.139240661=A+bug+(something+isn%27t+working)'

const IDEA_FORM =
  'https://docs.google.com/forms/d/e/1FAIpQLSd2qh1fzMefQPjqXJHQuj2-6haPeEKuK3BGpicM9N3dRv8pZg/viewform?usp=pp_url&entry.139240661=An+improvement+(things+work,+but+I+think+they+could+be+better)'

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
          Before each episode, you name a baker in five categories, and win points once the episode airs:
        </p>

        <h2 className="rules-h">Categories</h2>
        <table className="rules-table">
          <tbody>
            <tr><th>Best Baker</th><td className="pts">+4</td><td>Who gets Star Baker</td></tr>
            <tr><th>Leaving Baker</th><td className="pts">+3</td><td>Who goes home</td></tr>
            <tr><th>Technical Winner</th><td className="pts">+2</td><td>First in the technical</td></tr>
            <tr><th>Bingo Bonus</th><td className="pts">+2</td><td>Who the week's bingo event happens to</td></tr>
            <tr><th>Handshake</th><td className="pts">+2</td><td>Who gets a Hollywood handshake</td></tr>
          </tbody>
        </table>
        <p className="small muted">Thirteen points is a perfect week.</p>
        <p className="small muted">
          The Bingo Bonus changes every week and is usually tied to that
          week&rsquo;s theme. You predict <strong>which baker it happens to</strong>:
        </p>
        <p className="rules-eg">A judge says the word &ldquo;stodgy&rdquo; while judging a bake</p>


        <h2 className="rules-h">Penalties</h2>
        <p className="muted">
          Getting it very wrong will cost you points:
        </p>
        <table className="rules-table">
          <tbody>
            <tr><th>You said Star Baker, they went home</th><td className="pts cost">&minus;1</td></tr>
            <tr><th>You said they&rsquo;d go home, they got Star Baker</th><td className="pts cost">&minus;1</td></tr>
          </tbody>
        </table>
        <p className="small muted">
          Both can apply in the same week &mdash; and so can the lateness penalty
          below, so the worst a week can go is &minus;4.
        </p>
        <h2 className="rules-h">Weeks that don’t behave</h2>
        <ul className="rules-list">
          <li><strong>Two bakers go home?</strong> Naming either scores the full +3. </li>
          <li><strong>Leaving bakers only score when eliminated.</strong> Not when they leave in special circumstances. </li>
          <li><strong>Several handshakes, or the bingo hits several bakers?</strong> Same again: naming any of them scores once.</li>
          <li><strong>No Star Baker, no handshake, nobody leaves?</strong> That category goes to Nobody.</li>
        </ul>
      </Panel>

      <Panel head="Submitting, and the deadline">
        <p>
          Submit your picks via the Play tab, using the two-word code provided to you. It is your login, so do not share it!
        </p>
        <p>
        You can input and change your picks any time up to the deadline. <strong>Save picks</strong> stores them (do not forget to click it!), and <strong>Confirm</strong> locks your choices, indicating you are done. You can still <strong>Un-confirm</strong> and change them.
        </p>
        <h2 className="rules-h">Deadline</h2>
        {/* Set as a headline rather than a heading. It is the one time in the
            whole game everybody has to remember, and it now has a price
            attached — so it gets the weight the scorecard gives a week's
            points. */}
        <p className="rules-when">
          18:00 Tuesday
          <span className="rules-when-sub">the day of the episode</span>
        </p>
        <p>
          UK time. An incomplete entry still scores for whatever you did fill in.
        </p>

        <h2 className="rules-h">Lateness penalties</h2>
        <p className="small muted">
          <strong>Only one of these can apply per week</strong>, they do not stack. Not submitting carries the same penalty as submitting late, without the chance to win points.
        </p>
        <table className="rules-table">
          <tbody>
            <tr>
              <th>
                Submissions after 18:00 but before the episode begins (marked{' '}
                <span className="flag">LATE</span>)
              </th>
              <td className="pts cost">&minus;2</td>
            </tr>
            <tr>
              <th>
                Editing after 18:00 but before the episode begins (marked{' '}
                <span className="flag">LATE</span>)
              </th>
              <td className="pts cost">&minus;2</td>
            </tr>
            <tr>
              <th>
                Submissions after the start of the episode (marked{' '}
                <span className="flag">VERY LATE</span>)
              </th>
              <td className="pts cost">&minus;2</td>
            </tr>
            <tr>
              <th>Not submitting at all &mdash; an empty card counts as none</th>
              <td className="pts cost">&minus;2</td>
            </tr>
          </tbody>
        </table>


        <p className="notice">
          <strong>Everyone&rsquo;s picks go public when the episode starts airing.</strong>{' '}
          Submissions after the episode begins will only be allowed manually by the GM in very special
          circumstances, and are marked <span className="flag">VERY LATE</span>.
        </p>
      </Panel>

      <Panel head="Your top three">
        <h2 className="rules-h">Three bakers, once, for the whole series</h2>
        <p>
          After episode 1 you commit to
          three bakers to reach the final:
        </p>
        <table className="rules-table">
          <tbody>
            <tr><th>For each of your three who reaches the final</th><td className="pts">+3</td></tr>
            <tr><th>If the series winner is one of your three</th><td className="pts">+6</td></tr>
          </tbody>
        </table>
        <p className="small muted">
          A perfect set is 15. The +3s land when the semi-final ends and the
          finalists are known; the +6 at the final. Picks lock with episode
          2&rsquo;s deadline, and everyone&rsquo;s three go public when episode 2
          starts airing.
        </p>
      </Panel>

      {/* Before the top three in the reading order would be wrong — this is the
          smaller prize and the newer game — but it goes after it for a better
          reason: the two are a pair, and the top three is the one people already
          know. RULES.md orders them the same way. */}
      <Panel head="The bake guess">
        <h2 className="rules-h">Two bakes, before episode 1</h2>
        <p>
          Together with your episode 1 picks, choose two bakes you think will come up during the series. There are no changes
          after that.
        </p>
        <table className="rules-table">
          <tbody>
            <tr><th>It comes up and you were the only person to write it</th><td className="pts">+5</td></tr>
            <tr><th>It comes up and exactly two of you wrote it</th><td className="pts">+2</td></tr>
            <tr><th>It comes up and three or more of you wrote it</th><td className="pts">0</td></tr>
            <tr><th>It never comes up</th><td className="pts">0</td></tr>
          </tbody>
        </table>

        <h2 className="rules-h">What counts</h2>
        <ul className="rules-list">
          <li> To count as valid, the guess needs to be <strong>explicitly named in the task</strong>. For example, you guess <em>trifle</em>, and the Showstopper task is <em>Celebratory Free-Standing Trifle</em>. </li>
          <li>All three challenges count</li>
          <li>The GM&rsquo;s ruling is final, same as the bingo.</li>
        </ul>
      </Panel>

      <Panel head="The final">
        <p>
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
        <p className="rules-h">
          Most points at the end of the final wins. 
        </p>
        <p className="small muted">
        Ties go to most correct Star
          Baker calls, then Leaving Baker, then fewest penalties, then whoever
          was consistently the most organised about submitting.
        </p>
      </Panel>

      {/* The credit and the feedback form, in one box. They were two, and the
          merge is Elena's call: both are about the SITE rather than the game,
          so they belong after every rule and next to each other.

          Wording and link are hers. Note it says UNOFFICIAL: the site it
          credits states it is not affiliated with the programme, Channel 4 or
          Love Productions, so calling it official would be wrong twice over.

          No .colophon class on the paragraph any more. That style is small,
          soft and ruled off above — which was right for a credit sitting alone
          in a box, and wrong for the lead paragraph of a headed section. Its
          border-top is suppressed only for an :only-child, so keeping it here
          would draw a line under the head across empty space. */}
      <Panel head="About this Fantasy Bake Off">
        <p>
          This game is a home-made version of the unofficial{' '}
          <a href="https://fantasybakeoff.co.uk/" target="_blank" rel="noreferrer noopener">
            Fantasy Bake Off
          </a>
          , built with Claude Opus 5. If something does not work as you expect,
          or there is something that could be improved, please report it through
          the following form:
        </p>
        <div className="actions">
          <a className="btn" href={BUG_FORM} target="_blank" rel="noreferrer noopener">
            Report a bug
          </a>
          <a className="btn" href={IDEA_FORM} target="_blank" rel="noreferrer noopener">
            Suggest an improvement
          </a>
        </div>
      </Panel>
    </>
  )
}
