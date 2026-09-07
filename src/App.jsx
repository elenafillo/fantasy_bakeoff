import { usePath } from './lib/router.js'
import { Link } from './lib/Link.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Play from './pages/Play.jsx'
import Bakers from './pages/Bakers.jsx'
import Rules from './pages/Rules.jsx'
import Gm from './pages/Gm.jsx'

// Deliberately short labels so the bar fits one phone line without wrapping.
// /gm is not in here — it is not secret, but it is not an invitation either.
const NAV = [
  ['/', 'Table'],
  ['/play', 'Play'],
  ['/bakers', 'Bakers'],
  ['/rules', 'Rules'],
]

function route(path) {
  if (path === '/') return <Dashboard slug={null} />
  if (path === '/play') return <Play />
  if (path === '/bakers') return <Bakers />
  if (path === '/rules') return <Rules />
  if (path === '/gm') return <Gm />

  const league = path.match(/^\/league\/([a-z0-9-]+)\/?$/i)
  if (league) return <Dashboard slug={league[1]} />

  return (
    <div className="card">
      <h1>Nothing here</h1>
      <p className="muted">
        That page doesn&rsquo;t exist. <Link to="/">Back to the table</Link>.
      </p>
    </div>
  )
}

export default function App() {
  const path = usePath()

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand">
            Fantasy <em>Bake Off</em>
          </Link>
          <nav className="nav">
            {NAV.map(([to, label]) => (
              <Link key={to} to={to} aria-current={path === to ? 'page' : undefined}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="shell">{route(path)}</main>
    </>
  )
}
