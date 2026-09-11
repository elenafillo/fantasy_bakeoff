/**
 * The key that sits at the foot of a panel: "How to read this", shut.
 *
 * Every panel on the dashboard carries a small vocabulary somebody has to be
 * told once — an arrow that is about places and not points, a hatch that means
 * "paid nobody" rather than "not yet", a chip that came up and still scored
 * nothing. None of it is worth permanent space on a phone, and all of it is
 * worth one tap on the first night.
 *
 * IT IS SHUT BY DEFAULT, and that is the whole design: the panel above must
 * still read correctly for someone who never opens this. A key is the answer to
 * "what is that mark?", never the place a fact first appears. Anything a player
 * has to know to avoid misreading the panel belongs in the panel — the wall's
 * "these are last week's picks" notice is the model.
 *
 * It renders nothing on an empty panel, because every caller puts it in the
 * branch that has data. Explaining a table nobody can see is noise.
 *
 * `term` takes a node as happily as a string, so a key can show the actual mark
 * rather than describing it — the wall passes a real <Mark>, drawn by the same
 * component that draws the cells.
 */
export function HowToRead({ children }) {
  return (
    <details className="howto">
      <summary>How to read this</summary>
      <dl className="howto-list">{children}</dl>
    </details>
  )
}

/** One line of the key: the thing on screen, and what it means. */
export function Note({ term, children }) {
  return (
    <>
      <dt className="howto-term">{term}</dt>
      <dd className="howto-what">{children}</dd>
    </>
  )
}
