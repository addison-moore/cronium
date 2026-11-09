import {
  isFailureResult,
  ToolActionError,
  failureReason,
} from "../action-result";

describe("isFailureResult", () => {
  it("treats an explicit ok:false as failure (slack shape)", () => {
    expect(isFailureResult({ ok: false })).toBe(true);
  });

  it("treats an explicit success:false as failure (other tools)", () => {
    expect(isFailureResult({ success: false })).toBe(true);
    expect(isFailureResult({ success: false, error: "bad token" })).toBe(true);
  });

  it("does not treat a success result as failure", () => {
    expect(isFailureResult({ ok: true })).toBe(false);
    expect(isFailureResult({ success: true })).toBe(false);
  });

  it("does not treat a result lacking the flags as failure", () => {
    // A successful action may return arbitrary data with neither ok nor success.
    expect(isFailureResult({ messageId: "123" })).toBe(false);
    expect(isFailureResult({})).toBe(false);
  });

  it("only reacts to the literal false, not other falsy values", () => {
    expect(isFailureResult({ success: 0 })).toBe(false);
    expect(isFailureResult({ success: null })).toBe(false);
    expect(isFailureResult({ ok: undefined })).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isFailureResult(null)).toBe(false);
    expect(isFailureResult(undefined)).toBe(false);
    expect(isFailureResult("failed")).toBe(false);
    expect(isFailureResult(0)).toBe(false);
  });
});

describe("ToolActionError", () => {
  it("carries the original result and a name for the catch site", () => {
    const result = { success: false, error: "nope" };
    const err = new ToolActionError("nope", result);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ToolActionError");
    expect(err.message).toBe("nope");
    expect(err.result).toBe(result);
  });
});

describe("failureReason", () => {
  it("uses the reason an action gave", () => {
    expect(
      failureReason({ success: false, error: "no such host" }, "Run"),
    ).toBe("no such host");
  });

  it.each([
    ["no reason", { success: false }],
    ["an empty one", { ok: false, error: "" }],
    ["one that isn't text", { success: false, error: { code: 1 } }],
    ["nothing at all", null],
  ])("names the action when it gave %s", (_case, result) => {
    expect(failureReason(result, "Run Query")).toBe(
      "Run Query reported failure",
    );
  });
});
