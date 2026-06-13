// Derive a vendor "username" (folder-safe handle) from a display name.
// Rewrite rule: the result contains ONLY [a-z0-9_].

// Combining diacritical marks (U+0300–U+036F). Built from an ASCII string so the
// source file stays plain-ASCII and free of literal combining characters.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Lowercase the name, strip accents, turn every run of disallowed characters
 * into a single underscore, then trim stray underscores. Falls back to "vendor"
 * when nothing usable remains (e.g. a name that is all punctuation/emoji).
 *
 *   "BetaZen InfoTech!"   -> "betazen_infotech"
 *   "  Hello---World  "   -> "hello_world"
 *   "Cafe Deja 99"        -> "cafe_deja_99"
 *   "***"                 -> "vendor"
 */
export function usernameFromName(name: string): string {
  const base = (name || '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '') // drop accent marks so "é" -> "e"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // anything not a-z0-9 -> underscore
    .replace(/_+/g, '_') // collapse repeats
    .replace(/^_+|_+$/g, ''); // trim leading/trailing underscores
  return base || 'vendor';
}

/**
 * Make `base` unique against a set of already-taken usernames by appending
 * _2, _3, … until it's free. Pure (no DB) so it's unit-testable; the create
 * route supplies the taken set from a DB lookup.
 */
export function disambiguateUsername(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
