import { parseRetiredKeys } from "../../../../scripts/retired-keys.cjs";

const OLD = "a1b2c3d4".repeat(8);
const OLDER = "9f8e7d6c".repeat(8);

describe("parseRetiredKeys", () => {
  it.each([
    ["unset", undefined],
    ["empty, as the published compose file passes it when unset", ""],
    ["an empty list", "[]"],
  ])("%s: no keys, and nothing wrong", (_, raw) => {
    expect(parseRetiredKeys(raw)).toEqual({ keys: [], problem: null });
  });

  it("reads a list of keys, in order", () => {
    expect(parseRetiredKeys(JSON.stringify([OLD, OLDER]))).toEqual({
      keys: [OLD, OLDER],
      problem: null,
    });
  });

  it("keeps a key's case, which two of its readers derive from as a string", () => {
    const upper = OLD.toUpperCase();

    expect(parseRetiredKeys(JSON.stringify([upper])).keys).toEqual([upper]);
  });

  it("trims each key, so every reader gets the same one", () => {
    expect(parseRetiredKeys(JSON.stringify([` ${OLD}\n`]))).toEqual({
      keys: [OLD],
      problem: null,
    });
  });

  it("allows whitespace around the list", () => {
    expect(parseRetiredKeys(` ["${OLD}"] `).keys).toEqual([OLD]);
  });

  describe("a list that isn't one", () => {
    it.each([
      ["the inner quotes left out", `[${OLD}]`, "isn't valid JSON"],
      ["a bare key", OLD, "isn't valid JSON"],
      ["single quotes that reached the value", `'["${OLD}"]'`, "valid JSON"],
      ["only whitespace", "   ", "isn't valid JSON"],
      ["a comma too many", `["${OLD}",]`, "isn't valid JSON"],
      ["a JSON string", JSON.stringify(OLD), "not an array"],
      ["a JSON object", JSON.stringify({ key: OLD }), "not an array"],
      ["a key that's all digits", "1".repeat(64), "not an array"],
      ["JSON null", "null", "not an array"],
      ["JSON true", "true", "not an array"],
    ])("%s: no keys, and says what's wrong", (_, raw, says) => {
      const { keys, problem } = parseRetiredKeys(raw);

      expect(keys).toEqual([]);
      expect(problem).toContain(says);
      expect(problem).toContain("JSON array of 64-hex keys");
    });
  });

  describe("a list with an entry that won't work", () => {
    it.each([
      ["an empty string", '[""]', "entry 1 of 1 has 0 characters, not 64"],
      ["the doc's placeholder", '["<old-hex-key>"]', "has 13 characters"],
      [
        "a key missing its last character",
        JSON.stringify([OLD.slice(0, 63)]),
        "has 63 characters",
      ],
      [
        "a key with a character too many",
        JSON.stringify([`${OLD}0`]),
        "has 65 characters",
      ],
      [
        "64 characters that aren't all hex",
        JSON.stringify([`${OLD.slice(0, 63)}z`]),
        "has 64 characters, but they aren't all hex",
      ],
      ["a number", "[123]", "entry 1 of 1 isn't a string"],
      ["null", "[null]", "entry 1 of 1 isn't a string"],
      ["a nested list", `[["${OLD}"]]`, "entry 1 of 1 isn't a string"],
    ])("%s: no keys, and says which entry and why", (_, raw, says) => {
      const { keys, problem } = parseRetiredKeys(raw);

      expect(keys).toEqual([]);
      expect(problem).toContain(says);
    });

    it("keeps the good keys, for a reader that can't stop the process", () => {
      const { keys, problem } = parseRetiredKeys(
        JSON.stringify(["nope", OLD, 42, OLDER]),
      );

      expect(keys).toEqual([OLD, OLDER]);
      expect(problem).toContain("entry 1 of 4 has 4 characters, not 64");
    });

    it("names the first bad entry, wherever it is", () => {
      const { problem } = parseRetiredKeys(JSON.stringify([OLD, "nope"]));

      expect(problem).toContain("entry 2 of 2");
    });
  });

  // JSON.parse's own message quotes its input, so a key could reach a log through it.
  it.each([
    ["the inner quotes left out", `[${OLD}]`],
    ["a bare key", OLD],
    ["an object holding a key", JSON.stringify({ key: OLD })],
    ["a key cut short", JSON.stringify([OLD.slice(0, 63)])],
    ["a key that's too long", JSON.stringify([`${OLD}0`])],
    ["a good key beside a bad one", JSON.stringify([OLD, "nope"])],
  ])("%s: the message holds none of the value", (_, raw) => {
    const { problem } = parseRetiredKeys(raw);

    expect(problem).not.toBeNull();
    expect(problem).not.toContain(OLD.slice(0, 8));
    expect(problem).not.toContain("nope");
  });
});
