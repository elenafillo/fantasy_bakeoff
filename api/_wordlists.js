// ============================================================
// Two-word player codes — the vocabulary
// ============================================================
// The leading underscore keeps Vercel from routing this as an endpoint.
//
// This lives on the server beside _codes.js because both the GM panel
// (generateCode) and scripts/generate-players.mjs issue codes, and two copies of
// a wordlist drift the moment somebody edits one of them. The script imports
// from here; nothing under src/ ever does, because issuing a code in the browser
// would mean the browser deciding what a credential is.
//
// The pattern is:  adjective · bake        e.g. velvet-crumb, burnt-caramel
// Combinations are the product of the two lists — 35 × 32 = 1,120 as written.
//
// These lists are NOT secret. Knowing the vocabulary doesn't help you guess a
// code, because it also has to exist in the database — and `players` has no
// anon read path at all, so there is nothing to enumerate against.
//
// Rules if you edit them:
//   * No near-homophones ACROSS the two lists — a code gets read aloud across a
//     room. Two similar words in the same list is fine; the same word able to
//     land in either position is not.
//   * Nothing that's awkward to spell on a phone keyboard. The gate has no
//     autocomplete: people type these.
//   * Keep both lists comfortably longer than the roster. Codes are issued with
//     no word reused across the league, so a list of 12 words is a hard ceiling
//     of 12 players, not a shortage that shows up gradually.
//   * Removing a word does not invalidate a code already issued from it — the
//     stored code is a plain string. It only stops that word being issued again,
//     and makes prettyCode() fall back to the unsplit form.

export const ADJECTIVES = [
  'velvet', 'burnt', 'golden', 'soggy', 'crisp', 'sticky', 'toasted', 
  'salted', 'candied',  'glossy', 'humble', 'lavish', 'crumbly', 'silky',
  'spiced', 'zesty', 'frosted', 'marbled', 'risen', 'folded', 'whipped',
  'dusted', 'glazed', 'stuffed', 'rustic', 'dainty', 'hearty', 'smoky', 'tangy',
  'nutty', 'boozy', 'syrupy', 'flaky', 'jammy',  'wobbly',
]

export const BAKES = [
  'crumb', 'caramel', 'brioche', 'biscuit', 'scone', 'eclair', 'strudel', 'ganache',
  'praline', 'meringue', 'tartlet', 'baklava', 'crumpet', 'flapjack', 'shortbread', 'mousse',
  'macaron', 'madeleine', 'profiterole', 'panettone',  'teacake',
  'gingerbread', 'sponge', 'trifle', 'custard', 'fondant',
  'marzipan', 'wafer', 'churro', 'blondie', 'cannoli', 'tiramisu',
]

/**
 * Provisional identity colours (DESIGN.md §5). These only ever appear beside a
 * name and an avatar, so they don't have to survive the chart palette's
 * colour-blindness gate — but leaderboard neighbours should still look
 * different, so the order below alternates warm and cool rather than walking
 * the hue wheel.
 *
 * The first four are the validated chart hues, so the first four players
 * assigned also read correctly as chart lines.
 */
export const IDENTITY_COLOURS = [
  '#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7',
  '#e34948', '#00a0b0', '#eda100', '#8e44ad',
  '#008300', '#c2185b', '#3f51b5', '#e07a5f',
  '#5d7a1f', '#d1495b', '#6b4423', '#e87ba4',
]

/**
 * Recover the two halves of a stored code, or null if they can't be recovered.
 *
 * The remainder after the adjective has to be an EXACT bake. That strictness is
 * the point: 'crisp' is a prefix of nothing here today, but a looser match would
 * one day split a code in a misleading place, and this function decides both how
 * a code is read aloud and which words count as already in circulation.
 */
export function splitCode(norm) {
  const s = String(norm ?? '')
  const adj = ADJECTIVES.find((a) => s.startsWith(a) && BAKES.includes(s.slice(a.length)))
  return adj ? [adj, s.slice(adj.length)] : null
}

/**
 * Codes are stored normalised — "velvet-crumb" becomes "velvetcrumb" — because
 * that is the form the door compares against. Splitting it back into two words
 * is purely for reading: the GM panel lists codes to send to people, and
 * "velvet crumb" is easier to read aloud and retype than "velvetcrumb".
 *
 * A code that no longer matches the lists (a word edited out since it was
 * issued) falls back to the stored form. Either string logs in.
 */
export function prettyCode(norm) {
  const parts = splitCode(norm)
  return parts ? parts.join(' ') : String(norm ?? '')
}
