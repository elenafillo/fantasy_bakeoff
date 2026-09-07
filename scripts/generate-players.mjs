#!/usr/bin/env node
// ============================================================
// Generate player codes, colours and the SQL to insert them
// ============================================================
//
//   node scripts/generate-players.mjs --league proving-drawer Elena Sam "Ana Lucia"
//   node scripts/generate-players.mjs --league proving-drawer --gm Elena --file names.txt
//
// Writes supabase/players.seed.sql (git-ignored) and prints the roster to paste
// into your group chat. Nothing here touches the database — you paste the SQL
// into the Supabase editor yourself, so a mistake costs one re-run.
//
// Re-running generates DIFFERENT codes. Run it once, keep the output, and add
// later players with a second run using --append (which reads the existing file
// so it can avoid reissuing a code or a colour already in use).

import { writeFileSync, readFileSync, existsSync } from 'node:fs'
// Everything about a code comes from api/ rather than a copy in here: the words
// it is built from, the rule that issues it, and the function that normalises
// it are the same on both sides of the door. The GM panel's Players tab calls
// the very same issueCode.
import { IDENTITY_COLOURS } from '../api/_wordlists.js'
import { issueCode } from '../api/_codes.js'

const OUT = 'supabase/players.seed.sql'

// ---- arguments ----

const argv = process.argv.slice(2)
const opts = { league: null, gm: null, file: null, append: false, names: [] }

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--league') opts.league = argv[++i]
  else if (a === '--gm') opts.gm = argv[++i]
  else if (a === '--file') opts.file = argv[++i]
  else if (a === '--append') opts.append = true
  else if (a.startsWith('--')) fail(`Unknown option ${a}`)
  else opts.names.push(a)
}

if (opts.file) {
  opts.names.push(
    ...readFileSync(opts.file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
  )
}

if (!opts.league) fail('--league <slug> is required.')
if (opts.names.length === 0) fail('Give at least one player name, or --file names.txt')

const dupes = opts.names.filter((n, i) => opts.names.indexOf(n) !== i)
if (dupes.length) fail(`Duplicate names: ${[...new Set(dupes)].join(', ')}`)

if (opts.gm && !opts.names.includes(opts.gm)) {
  fail(`--gm "${opts.gm}" is not in the list of names.`)
}

// ---- don't reissue anything already in the file ----

const takenCodes = new Set()
const takenColours = new Set()

if (opts.append) {
  if (!existsSync(OUT)) fail(`--append needs an existing ${OUT}`)
  const prior = readFileSync(OUT, 'utf8')
  for (const m of prior.matchAll(/'([a-z]+)',\s*'(#[0-9a-f]{6})'/gi)) {
    takenCodes.add(m[1])
    takenColours.add(m[2].toLowerCase())
  }
  console.log(`Appending — ${takenCodes.size} existing codes held back.\n`)
}

// ---- generate ----

// issueCode holds the no-shared-words rule (api/_codes.js). Each new code is
// added to takenCodes before the next call, so a word is held back the moment
// it is used — including on --append, where the codes recovered from the
// existing file are already in there.
function makeCode() {
  try {
    const issued = issueCode({ roster: [...takenCodes] })
    takenCodes.add(issued.norm)
    return issued
  } catch (err) {
    fail(err.message)
  }
}

const free = IDENTITY_COLOURS.filter((c) => !takenColours.has(c.toLowerCase()))
if (opts.names.length > free.length) {
  fail(
    `${opts.names.length} players but only ${free.length} unused colours. ` +
    `Add more to IDENTITY_COLOURS in api/_wordlists.js — note DESIGN.md §5 ` +
    `on keeping leaderboard neighbours distinguishable.`
  )
}

const roster = opts.names.map((name, i) => {
  const { code, norm } = makeCode()
  return { name, code, norm, colour: free[i], isGm: name === opts.gm }
})

// ---- SQL ----

const header = `-- ============================================================
-- Player roster — GENERATED, git-ignored
-- ============================================================
-- A code IS the credential: anyone holding one can submit as that player. This
-- file is git-ignored for that reason and nothing reads it at runtime — paste
-- each block into the Supabase SQL editor once, and after that the database is
-- the source of truth (GM panel → Players).
--
-- Safe to re-run: on conflict, names, colours and GM status update, codes do not.
--
-- APPEND ONLY. Later runs with --append add a block below and must be able to
-- read every earlier one, because that is how they know which codes, words and
-- colours are already in circulation. Deleting a block risks reissuing them.
`

const block = `
-- ---- ${roster.length} player(s), ${new Date().toISOString()}, league "${opts.league}" ----

insert into players (league_id, display_name, code_norm, colour_hex, is_gm)
select l.id, v.display_name, v.code_norm, v.colour_hex, v.is_gm
from leagues l
cross join (values
${roster.map((p) => `  (${sqlStr(p.name)}, '${p.norm}', '${p.colour}', ${p.isGm})`).join(',\n')}
) as v(display_name, code_norm, colour_hex, is_gm)
where l.slug = ${sqlStr(opts.league)}
on conflict (code_norm) do update
  set display_name = excluded.display_name,
      colour_hex   = excluded.colour_hex,
      is_gm        = excluded.is_gm;

select display_name, colour_hex, is_gm from players order by display_name;
`

// Append rather than replace: the file is the record of what has been issued,
// and the next --append run parses it to avoid reissuing a code, a word or a
// colour. Overwriting it would silently break that.
writeFileSync(OUT, opts.append ? readFileSync(OUT, 'utf8') + block : header + block)

// ---- the human-readable half ----

const pad = Math.max(...roster.map((p) => p.name.length))
console.log(
  opts.append
    ? `Appended a block to ${OUT} — paste ONLY the new block into Supabase.\n`
    : `Wrote ${OUT} — paste it into the Supabase SQL editor.\n`
)
console.log('Roster — send each person only their own line:\n')
for (const p of roster) {
  console.log(`  ${p.name.padEnd(pad)}  ${p.code.padEnd(22)} ${p.colour}${p.isGm ? '  (GM)' : ''}`)
}
console.log(`\n${roster.length} players. Codes are case- and punctuation-insensitive.`)

function sqlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

function fail(msg) {
  console.error(`\n  ${msg}\n`)
  process.exit(1)
}
