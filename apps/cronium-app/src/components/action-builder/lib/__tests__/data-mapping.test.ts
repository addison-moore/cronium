import {
  createEmptyMapping,
  deriveSourceFields,
  deriveTargetFields,
  removeMappingAt,
  updateMappingAt,
} from "../data-mapping";
import { type DataMapping } from "../../types";

describe("deriveSourceFields", () => {
  it("maps schema keys to their JS typeof", () => {
    expect(
      deriveSourceFields({ name: "x", count: 1, config: { nested: true } }),
    ).toEqual([
      { name: "name", type: "string" },
      { name: "count", type: "number" },
      { name: "config", type: "object" },
    ]);
  });

  it("returns an empty list for an empty schema", () => {
    expect(deriveSourceFields({})).toEqual([]);
  });
});

describe("deriveTargetFields", () => {
  it("reads the required flag from schema objects", () => {
    expect(
      deriveTargetFields({
        to: { required: true },
        cc: { required: false },
        subject: {},
      }),
    ).toEqual([
      { name: "to", type: "object", required: true },
      { name: "cc", type: "object", required: false },
      { name: "subject", type: "object", required: false },
    ]);
  });

  it("defaults required to false for scalar and null schema values (pinned)", () => {
    expect(
      deriveTargetFields({ plain: "string-schema", nothing: null }),
    ).toEqual([
      { name: "plain", type: "string", required: false },
      // typeof null === "object" — preserved JS quirk
      { name: "nothing", type: "object", required: false },
    ]);
  });
});

describe("createEmptyMapping", () => {
  it("starts with no source/target and a direct transformer", () => {
    expect(createEmptyMapping()).toEqual({
      sourceField: "",
      targetField: "",
      transformer: "direct",
    });
  });
});

describe("updateMappingAt", () => {
  const base: DataMapping[] = [
    { sourceField: "a", targetField: "x", transformer: "direct" },
    { sourceField: "b", targetField: "y", transformer: "template" },
  ];

  it("merges updates into the addressed mapping without mutating the input", () => {
    const next = updateMappingAt(base, 1, {
      transformer: "expression",
      transformerConfig: { expression: "value.toUpperCase()" },
    });
    expect(next[1]).toEqual({
      sourceField: "b",
      targetField: "y",
      transformer: "expression",
      transformerConfig: { expression: "value.toUpperCase()" },
    });
    expect(next[0]).toBe(base[0]);
    expect(base[1]!.transformer).toBe("template");
  });

  it("accepts any source/target combination — no type checking (pinned)", () => {
    // Mapping a number-typed source onto a string-typed target is not
    // rejected anywhere in the assembly layer; validation is the consumer's
    // problem. Pinned so a future "helpful" check is a conscious decision.
    const next = updateMappingAt(base, 0, {
      sourceField: "count",
      targetField: "name",
    });
    expect(next[0]).toEqual({
      sourceField: "count",
      targetField: "name",
      transformer: "direct",
    });
  });

  it("writes updates-only for an out-of-range index (pinned quirk)", () => {
    const single: DataMapping[] = [
      { sourceField: "a", targetField: "x", transformer: "direct" },
    ];
    const next = updateMappingAt(single, 2, { sourceField: "ghost" });
    expect(next).toHaveLength(3);
    expect(next[1]).toBeUndefined();
    expect(next[2]).toEqual({ sourceField: "ghost" });
  });
});

describe("removeMappingAt", () => {
  const base: DataMapping[] = [
    { sourceField: "a", targetField: "x", transformer: "direct" },
    { sourceField: "b", targetField: "y", transformer: "direct" },
  ];

  it("removes the addressed mapping immutably", () => {
    const next = removeMappingAt(base, 0);
    expect(next).toEqual([
      { sourceField: "b", targetField: "y", transformer: "direct" },
    ]);
    expect(base).toHaveLength(2);
  });

  it("returns an equal copy for an out-of-range index", () => {
    const next = removeMappingAt(base, 5);
    expect(next).toEqual(base);
    expect(next).not.toBe(base);
  });
});
