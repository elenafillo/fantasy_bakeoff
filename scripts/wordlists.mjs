// ============================================================
// Two-word player codes
// ============================================================
// 40 × 40 = 1,600 combinations, in the pattern:
//     adjective · bake        e.g. velvet-crumb, burnt-caramel
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
//   * Keep both at 40 so the combination count stays honest.

export const ADJECTIVES = [
  'velvet', 'burnt', 'golden', 'soggy', 'crisp', 'sticky', 'toasted', 'brandy',
  'salted', 'candied', 'buttered', 'glossy', 'humble', 'lavish', 'crumbly', 'silky',
  'spiced', 'zesty', 'frosted', 'marbled', 'proving', 'risen', 'folded', 'whipped',
  'dusted', 'glazed', 'stuffed', 'rustic', 'dainty', 'hearty', 'smoky', 'tangy',
  'nutty', 'boozy', 'syrupy', 'flaky', 'gilded', 'jammy', 'peppery', 'wobbly',
]

export const BAKES = [
  'crumb', 'caramel', 'brioche', 'pavlova', 'scone', 'eclair', 'strudel', 'ganache',
  'praline', 'meringue', 'tartlet', 'baklava', 'crumpet', 'flapjack', 'shortbread', 'parkin',
  'stollen', 'macaron', 'madeleine', 'profiterole', 'panettone', 'battenberg', 'lardy', 'teacake',
  'crostata', 'financier', 'gingerbread', 'sponge', 'trifle', 'custard', 'fondant', 'nougat',
  'marzipan', 'brittle', 'wafer', 'churro', 'blondie', 'cannoli', 'tiramisu', 'clafoutis',
]

/**
 * Absorb casing, spaces, hyphens and stray punctuation so "Velvet Crumb",
 * "velvet-crumb" and "velvetcrumb" are the same code. It does NOT absorb
 * misspellings — if someone is stuck at the door, look their code up in the GM
 * panel rather than trying to guess what they typed.
 *
 * Used on both sides: to build code_norm here, and to match it in api/player.js.
 * The two must stay identical, which is why it lives in one file.
 */
export function normaliseCode(raw) {
  return String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '')
}

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
