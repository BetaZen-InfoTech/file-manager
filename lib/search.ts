// Build a safe case-insensitive search RegExp from untrusted user input.
// Escapes all regex metacharacters (preventing RegExp/ReDoS injection) and caps
// the length so a pathological pattern can't pin DB CPU. Returns null for empty
// input so callers can skip the filter entirely.
export function safeSearchRegExp(input: string | null | undefined, maxLen = 100): RegExp | null {
  const s = (input || '').slice(0, maxLen).trim();
  if (!s) return null;
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}
