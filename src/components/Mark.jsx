/**
 * The tick (or cross) that sits beside a pick.
 *
 * It exists as its own component because two screens draw the same mark and
 * must not drift: the scorecard on /play, and the dashboard's prediction wall.
 * The wall's cells are a fraction of the size, but the mark is the same mark.
 *
 * `label` is the word behind the glyph, read out but not drawn. The two callers
 * differ on purpose:
 *
 *   The scorecard has room for prose, and the prose already says it — "Right ·
 *   Baker Five", "It was Baker Three". So it passes no label, and marks only
 *   the correct picks: a wrong pick there is the ordinary outcome, costs
 *   nothing, and recedes so the rows that DO cost something can stand out.
 *
 *   A wall cell is a name in a box. There is no prose to carry it, so a wrong
 *   pick gets a cross as well as the grey — colour and tone are never the only
 *   signal (DESIGN §5) — and both marks carry their word.
 */
export function Mark({ glyph, label }) {
  return (
    <span className="verdict-mark">
      <span aria-hidden="true">{glyph}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
