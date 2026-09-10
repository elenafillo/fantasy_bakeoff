// ============================================================
// The bake guess — the canonical form
// ============================================================
// The leading underscore keeps Vercel from routing this as an endpoint.
//
// Both endpoints write `guess_key` and they must agree on what it looks like:
// api/player.js derives it when the player saves, api/gm.js overwrites it when
// the GM unifies. Two answers here would mean a guess that scored as one thing
// on the way in and another on the way out.
//
// WHAT THIS DELIBERATELY DOES NOT DO: stem, singularise, or otherwise guess at
// meaning. "madeleines" does NOT become "madeleine" here. Unifying those two is
// SCORING-RELEVANT — it can move somebody from sole (+5) to shared (+2) — so it
// is the GM's call, made once, visibly, on the Guesses tab, where the original
// text stays beside it. An automatic version of the same decision would take a
// point off somebody with nothing on screen to point at.
//
// So this normalises only the things nobody would argue about: case, and the
// whitespace and punctuation you get from typing on a phone.

/**
 * The canonical form of what a player typed.
 *
 * Lowercased, trimmed, internal whitespace collapsed, and surrounding
 * punctuation stripped — so "  Madeleine. " and "madeleine" are one guess, and
 * "madeleines" is still a different one.
 *
 * Returns '' for anything with no letters or digits in it, which callers treat
 * as "not a guess".
 */
export function normaliseGuess(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    // Punctuation at the edges only. An apostrophe or a hyphen INSIDE a word is
    // part of it — "st. clement's", "mille-feuille" — and dropping those would
    // be the same silent re-interpretation this file exists to avoid.
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** What a player is allowed to type. Long enough to be a bake, short enough to fit a board. */
export const GUESS_MAX = 40
export const GUESS_SLOTS = 2
