/**
 * What a person reads when the atomic rate limiter couldn't be asked, as when Valkey is down or
 * full. The limiter fails closed, so the request was still refused: this says so without
 * blaming attempts nobody counted. It's here so the sign-in pages can show it too.
 */
export const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "Cronium can't check its limit on attempts right now, usually because Valkey is down or full, so it didn't go ahead. Try again shortly.";

/**
 * The `error` NextAuth passes on for a sign-in refused because the limiter couldn't be asked.
 * NextAuth puts a thrown error's message in a URL, so this is a code, like `MFA_REQUIRED`, and
 * the pages show the message above for it.
 */
export const RATE_LIMIT_UNAVAILABLE = "RATE_LIMIT_UNAVAILABLE";
