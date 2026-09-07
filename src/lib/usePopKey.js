import { useState } from 'react'

/**
 * A key that changes whenever `value` does, so a CSS animation can be restarted
 * by remounting the element that carries it.
 *
 * A score changing is the one moment DESIGN §10 says is worth animating — 400ms
 * with a slight overshoot. The animation has to fire when the number *changes*
 * and not when the panel first opens, where it would be a flourish for
 * something nobody watched happen. There is no way to restart a CSS animation
 * without either touching the DOM directly or remounting, and remounting on a
 * key is the one React sanctions.
 *
 * `pops` is 0 until the first change, so the caller can tell "first paint" from
 * "it just moved" and only animate the second.
 *
 * The state is adjusted during render rather than in an effect: an effect would
 * paint one frame of the old number first, and React's own guidance is to
 * adjust state directly when it derives from a changed prop. Play.jsx and the
 * scorecard both do the same thing.
 */
export function usePopKey(value) {
  const [seen, setSeen] = useState(value)
  const [pops, setPops] = useState(0)

  if (seen !== value) {
    setSeen(value)
    setPops((n) => n + 1)
  }

  return pops
}
