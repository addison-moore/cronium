/**
 * Runtime stub for `nanoid` (mapped in the Storage Tests project's
 * moduleNameMapper). nanoid v5 is ESM-only and ts-jest doesn't transform it;
 * only `customAlphabet` is used (for job ids), so a tiny deterministic-enough
 * generator suffices for tests.
 */
import { randomInt } from "crypto";

export function customAlphabet(alphabet: string, defaultSize = 12) {
  return (size = defaultSize): string => {
    let out = "";
    for (let i = 0; i < size; i++) {
      out += alphabet[randomInt(alphabet.length)];
    }
    return out;
  };
}
