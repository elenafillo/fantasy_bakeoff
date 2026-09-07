/**
 * A player's avatar.
 *
 * Phase 7 replaces the inside of this with assembled SVG parts, read from
 * `config` ({ body, eyes, mouth, colour }). Until those exist it is a coloured
 * circle with an initial — and because every caller goes through this
 * component, that swap touches nothing else (TECH_PLAN §7).
 */
export function Avatar({ name, colour, size = 40 }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return (
    <span
      className="avatar"
      style={{ background: colour, width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}
