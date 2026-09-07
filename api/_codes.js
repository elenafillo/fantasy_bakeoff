// ============================================================
// Code normalisation — the canonical implementation
// ============================================================
// The leading underscore keeps Vercel from routing this as an endpoint.
//
// This lives on the server side because it is security-relevant: a code IS the
// credential, and normalisation decides which typed strings match a stored one.
// scripts/generate-players.mjs imports it from here rather than keeping its own
// copy, so the string written into code_norm and the string compared at the
// door can never drift apart. Two implementations of this would eventually
// disagree, and the symptom would be a friend who cannot log in with a code
// that is demonstrably theirs.

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
