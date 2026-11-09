/**
 * @jest-environment node
 *
 * What the inbound endpoint refuses because Postgres would. Real Postgres decides these
 * in tests/storage/webhook-delivery-id-release.test.ts, through the real route.
 */
import {
  MAX_INBOUND_EVENT_NAME_CHARS,
  MAX_INBOUND_JSON_DEPTH,
  tooDeeplyNested,
  unstorableEvent,
} from "../storable-event";

/** One character, though it's two of a string's `length`. */
const EMOJI = "\u{1F600}";
const NUL = /NUL character \(U\+0000\)/;

describe("unstorableEvent", () => {
  it("takes an ordinary event", () => {
    expect(unstorableEvent("order.created", { order: 1 })).toBeUndefined();
  });

  describe("an event's name", () => {
    it("can be 247 characters, so `webhook.<name>` fits in 255", () => {
      expect(MAX_INBOUND_EVENT_NAME_CHARS).toBe(247);
      expect(unstorableEvent("x".repeat(247), {})).toBeUndefined();
    });

    it("can't be longer, and the answer says by how much", () => {
      expect(unstorableEvent("x".repeat(248), {})).toBe(
        "This event's name is too long: it has 248 characters, and the limit is 247.",
      );
    });

    it("is counted in characters, as Postgres counts them", () => {
      expect(unstorableEvent(EMOJI.repeat(247), {})).toBeUndefined();
      expect(unstorableEvent(EMOJI.repeat(248), {})).toMatch(
        /it has 248 characters/,
      );
    });

    it("can't have a NUL, even where the content doesn't repeat it", () => {
      expect(unstorableEvent("order\u0000created", {})).toMatch(NUL);
    });

    it("can't have half of a surrogate pair", () => {
      expect(unstorableEvent("order\ud83d", {})).toMatch(/\(U\+D83D\)/);
    });
  });

  describe("an event's content", () => {
    it.each([
      ["a value", { note: "\u0000" }],
      ["a key", { "a\u0000": 1 }],
      ["an array", { notes: ["fine", "\u0000"] }],
      ["an object in an array", { notes: [{ deep: [{ deeper: "\u0000" }] }] }],
      ["a key deep down", { a: { b: { "c\u0000": true } } }],
    ])("can't have a NUL in %s", (_where, payload) => {
      expect(unstorableEvent("order.created", payload)).toBe(
        "This event can't be stored: it has a NUL character (U+0000), which Postgres doesn't allow in text.",
      );
    });

    it.each([
      ["a high half in a value", { note: "\ud83d" }, "D83D"],
      ["a low half in a value", { note: "x\ude00y" }, "DE00"],
      ["a half in a key", { "\udbff": 1 }, "DBFF"],
      ["the halves the wrong way round", { note: "\ude00\ud83d" }, "DE00"],
    ])("can't have %s of a surrogate pair", (_what, payload, codeUnit) => {
      expect(unstorableEvent("order.created", payload)).toBe(
        `This event can't be stored: it has half of a UTF-16 surrogate pair (U+${codeUnit}) on its own, which isn't valid Unicode.`,
      );
    });

    it("can have whole pairs, other control characters and the text `\\u0000`", () => {
      expect(
        unstorableEvent("order.created", {
          pair: "\ud83d\ude00",
          [EMOJI]: EMOJI,
          control: "\u0001\u001f\u007f",
          written: "\\u0000",
          last: "\uffff",
          numbers: [0, 1.5, null, true],
        }),
      ).toBeUndefined();
    });

    it("is looked through however deep it nests", () => {
      let deep: unknown = "\u0000";
      for (let level = 0; level < 100_000; level++) deep = [deep];

      expect(unstorableEvent("order.created", { deep })).toMatch(NUL);
    });
  });
});

describe("tooDeeplyNested", () => {
  /** `value` inside `depth` arrays, one inside the next. */
  const inArrays = (depth: number, value: unknown = 1) => {
    let nested = value;
    for (let level = 0; level < depth; level++) nested = [nested];
    return nested;
  };
  /** `value` inside `depth` objects, one inside the next. */
  const inObjects = (depth: number, value: unknown = 1) => {
    let nested = value;
    for (let level = 0; level < depth; level++) nested = { a: nested };
    return nested;
  };
  const tooDeep = (depth: string) =>
    `This event is nested too deeply: it has arrays and objects ${depth} levels deep, and the limit is 256.`;

  it("takes arrays and objects 256 levels deep", () => {
    expect(MAX_INBOUND_JSON_DEPTH).toBe(256);
    expect(tooDeeplyNested(inArrays(256))).toBeUndefined();
    expect(tooDeeplyNested(inObjects(256))).toBeUndefined();
    expect(tooDeeplyNested(inObjects(128, inArrays(128)))).toBeUndefined();
  });

  it("refuses one level more, and says how deep it went", () => {
    expect(tooDeeplyNested(inArrays(257))).toBe(tooDeep("257"));
    expect(tooDeeplyNested(inObjects(257))).toBe(tooDeep("257"));
    expect(tooDeeplyNested(inArrays(128, inObjects(129)))).toBe(tooDeep("257"));
  });

  it("counts an empty array or object as a level, and anything else as none", () => {
    expect(tooDeeplyNested(inArrays(256, []))).toBe(tooDeep("257"));
    expect(tooDeeplyNested(inArrays(256, {}))).toBe(tooDeep("257"));
    for (const leaf of ["text", "", 0, true, null]) {
      expect(tooDeeplyNested(inArrays(256, leaf))).toBeUndefined();
    }
    expect(tooDeeplyNested("text")).toBeUndefined();
    expect(tooDeeplyNested({ note: "a form's fields" })).toBeUndefined();
  });

  it("goes by the deepest branch, wherever it is", () => {
    const deep = inArrays(256);
    expect(tooDeeplyNested({ first: 1, deep, last: [1, 2] })).toBe(
      tooDeep("257"),
    );
    expect(tooDeeplyNested([[1], [[1]], 1, deep])).toBe(tooDeep("257"));
    expect(tooDeeplyNested([inArrays(255), inObjects(10)])).toBeUndefined();
  });

  it("doesn't count how wide it is", () => {
    const wide = Array.from({ length: 100_000 }, (_, n) => ({ [n]: [n] }));
    expect(tooDeeplyNested({ wide })).toBeUndefined();
  });

  it("looks inside a key JSON.parse makes an own property, such as __proto__", () => {
    const parsed: unknown = JSON.parse(
      `{"__proto__":${"[".repeat(256)}1${"]".repeat(256)}}`,
    );
    expect(tooDeeplyNested(parsed)).toBe(tooDeep("257"));
  });

  it("can't be made to fail by how deep it goes", () => {
    expect(tooDeeplyNested(inArrays(1_000_000))).toBe(tooDeep("1,000,000"));
    expect(tooDeeplyNested(inObjects(1_000_000))).toBe(tooDeep("1,000,000"));
  });
});
