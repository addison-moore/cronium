import { pgStorableText } from "@/lib/pg-text";

describe("pgStorableText", () => {
  it.each([
    ["a NUL byte", "before\0after", "beforeafter"],
    ["nothing but NUL bytes", "\0\0\0", ""],
    ["a lone high surrogate", "a\uD83Db", "a\uFFFDb"],
    ["a lone low surrogate", "a\uDE00b", "a\uFFFDb"],
    ["half an emoji left by a cut", "😀".slice(0, 1), "\uFFFD"],
  ])("cleans %s", (_name, text, stored) => {
    expect(pgStorableText(text)).toBe(stored);
  });

  it.each([["plain text"], ["😀 a whole emoji"], ["line\nbreak\ttab"], [""]])(
    "leaves %j alone",
    (text) => {
      expect(pgStorableText(text)).toBe(text);
    },
  );
});
