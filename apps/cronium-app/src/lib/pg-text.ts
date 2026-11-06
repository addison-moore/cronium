/**
 * `text` as Postgres can store it. Postgres refuses a NUL byte in any string, and
 * jsonb refuses a lone surrogate. A `text` column would take that one, but stores
 * U+FFFD, so it's replaced here too: what's stored is then what's reported.
 */
export function pgStorableText(text: string): string {
  return text.replaceAll("\u0000", "").replace(/\p{Cs}/gu, "\uFFFD");
}
