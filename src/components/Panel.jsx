/**
 * The default container. Almost nothing in this app sits directly on the pink
 * ground — it lives on one of these, which is what keeps the chart palette
 * valid and player colours distinct (DESIGN.md §2).
 *
 * `head` renders the scalloped icing band. Optional, and worth leaving off more
 * often than on: one decorative motif reads as a choice, on every panel it
 * reads as a template.
 */
export function Panel({ head, children }) {
  return (
    <section className="panel">
      {head && <div className="panel-head">{head}</div>}
      <div className="panel-body">{children}</div>
    </section>
  )
}
