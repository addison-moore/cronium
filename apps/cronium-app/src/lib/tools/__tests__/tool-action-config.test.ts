import { parseToolActionConfig } from "../tool-action-config";

const CONFIG = { toolType: "slack", toolId: 3, actionId: "slack-send-message" };

describe("parseToolActionConfig", () => {
  it("returns an object as-is (newer events)", () => {
    expect(parseToolActionConfig(CONFIG)).toEqual(CONFIG);
  });

  it("parses a single JSON string (the common stored shape)", () => {
    expect(parseToolActionConfig(JSON.stringify(CONFIG))).toEqual(CONFIG);
  });

  it("parses a double-encoded JSON string", () => {
    expect(
      parseToolActionConfig(JSON.stringify(JSON.stringify(CONFIG))),
    ).toEqual(CONFIG);
  });

  it("returns null for empty / whitespace / null / undefined", () => {
    expect(parseToolActionConfig("")).toBeNull();
    expect(parseToolActionConfig("   ")).toBeNull();
    expect(parseToolActionConfig(null)).toBeNull();
    expect(parseToolActionConfig(undefined)).toBeNull();
  });

  it("returns null for malformed JSON and non-config primitives", () => {
    expect(parseToolActionConfig("{not json")).toBeNull();
    expect(parseToolActionConfig(42)).toBeNull();
  });

  it("returns null for arrays (a config must be an object)", () => {
    expect(parseToolActionConfig([1, 2, 3])).toBeNull();
    expect(parseToolActionConfig(JSON.stringify([1, 2, 3]))).toBeNull();
  });
});
