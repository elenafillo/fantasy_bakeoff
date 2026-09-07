// ============================================================
// Codes — normalising them, and issuing them
// ============================================================
// The leading underscore keeps Vercel from routing this as an endpoint.
//
// This lives on the server side because it is security-relevant: a code IS the
// credential, and normalisation decides which typed strings match a stored one.
// Both the GM panel and scripts/generate-players.mjs import from here rather
// than keeping their own copy, so the string written into code_norm and the
// string compared at the door can never drift apart. Two implementations of
// this would eventually disagree, and the symptom would be a friend who cannot
// log in with a code that is demonstrably theirs.

import { randomInt } from 'node:crypto'
import { ADJECTIVES, BAKES, splitCode } from './_wordlists.js'

/**
 * Absorbs casing, spaces, hyphens and stray punctuation, so "Velvet Crumb",
 * "velvet-crumb" and "velvetcrumb" are all the same code.
 *
 * It does NOT absorb misspellings. If someone is stuck at the door, look their
 * code up in the GM panel rather than guessing what they typed.
 */
export function normaliseCode(raw) {
  return String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Issue a fresh two-word code.
 *
 *   roster — codes already held in the same league. NO WORD from any of them is
 *            reused, which is the rule that matters: codes get read aloud across
 *            a noisy room and typed by someone half-watching television, and a
 *            near-miss that happens to be somebody else's code is the one
 *            failure this can actually prevent. "whipped-gingerbread" and
 *            "boozy-gingerbread" are distinct codes and a terrible pair.
 *   taken  — every code that exists anywhere, since code_norm is unique across
 *            all leagues. Defaults to the roster, which is right for a script
 *            generating a single league in one go.
 *
 * randomInt is crypto-backed rather than Math.random — not because anyone is
 * attacking a bake-off league, but because Math.random seeded from the clock can
 * repeat across two runs a second apart, and a duplicate code is a real mess to
 * unpick once it is in someone's phone.
 */
export function issueCode({ roster = [], taken = roster } = {}) {
  const usedWords = new Set()
  for (const code of roster) {
    const parts = splitCode(normaliseCode(code))
    if (parts) { usedWords.add(parts[0]); usedWords.add(parts[1]) }
  }
  const usedCodes = new Set([...taken].map(normaliseCode))

  for (let tries = 0; tries < 800; tries++) {
    const adj = ADJECTIVES[randomInt(ADJECTIVES.length)]
    const bake = BAKES[randomInt(BAKES.length)]
    if (usedWords.has(adj) || usedWords.has(bake)) continue

    const norm = normaliseCode(`${adj}-${bake}`)
    if (usedCodes.has(norm)) continue

    return { code: `${adj}-${bake}`, norm }
  }

  throw new Error(
    'Could not find a code with two unused words. Either the league is close to ' +
    `${Math.min(ADJECTIVES.length, BAKES.length)} players, or the wordlists in ` +
    'api/_wordlists.js need extending.'
  )
}
