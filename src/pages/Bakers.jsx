import { Panel } from '../components/Panel.jsx'

/**
 * The cast grid — who's who, for people deciding their picks. Built in phase 6.
 * Eliminated bakers grey out and sink to the bottom.
 */
export default function Bakers() {
  return (
    <Panel head="The tent">
      <h1>The bakers</h1>
      <p className="muted">Phase 6. A card per baker with:</p>
      <ul className="stub-list">
        <li>Photo, name, a one-line bio</li>
        <li>Star Bakers, technical wins, handshakes, weeks survived</li>
        <li>League stats — how often picked, how often written off</li>
        <li>Greyed out and moved to the bottom once eliminated</li>
      </ul>
    </Panel>
  )
}
