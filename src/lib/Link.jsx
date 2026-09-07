import { navigate } from './router.js'

/**
 * An <a> that routes internally, but still honours cmd/ctrl-click and
 * middle-click so "open in new tab" keeps working — which matters, because
 * putting the dashboard on a second screen is a thing people will do.
 */
export function Link({ to, children, ...rest }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}
