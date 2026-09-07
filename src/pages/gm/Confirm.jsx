import { useState } from 'react'

/**
 * Two taps for the buttons that are hard to undo. Going live locks everyone
 * out, taking it back throws away the original timestamp, and reissuing a code
 * invalidates the one already in somebody's phone — none of those should be one
 * stray thumb away while holding a phone at an angle.
 */
export function Confirm({ label, confirmLabel, note, className = 'btn', busy, onConfirm }) {
  const [armed, setArmed] = useState(false)

  if (!armed) {
    return (
      <button className={className} disabled={busy} onClick={() => setArmed(true)}>
        {label}
      </button>
    )
  }

  return (
    <>
      {note && <p className="notice">{note}</p>}
      <div className="actions">
        <button
          className="btn"
          disabled={busy}
          onClick={() => { setArmed(false); onConfirm() }}
        >
          {confirmLabel}
        </button>
        <button className="btn btn-quiet" onClick={() => setArmed(false)}>Cancel</button>
      </div>
    </>
  )
}
