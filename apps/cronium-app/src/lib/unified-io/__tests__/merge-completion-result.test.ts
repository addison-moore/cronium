/**
 * @jest-environment node
 */
import { mergeCompletionResult } from "../merge-completion-result";

describe("mergeCompletionResult", () => {
  it("carries a condition forward when the script published no output", () => {
    // The regression: setCondition() without output() used to be dropped at
    // completion, which is one reason workflow ON_CONDITION edges never fired.
    const merged = mergeCompletionResult({ condition: true }, 0);
    expect(merged).toEqual({ condition: true, exitCode: 0 });
  });

  it("promotes output to scriptOutput (the field workflow chaining reads)", () => {
    const merged = mergeCompletionResult({ output: { rows: [1] } }, 0);
    expect(merged).toEqual({
      output: { rows: [1] },
      scriptOutput: { rows: [1] },
      exitCode: 0,
    });
  });

  it("carries output and condition together", () => {
    const merged = mergeCompletionResult({ output: "hi", condition: false }, 0);
    expect(merged).toMatchObject({
      output: "hi",
      scriptOutput: "hi",
      condition: false,
      exitCode: 0,
    });
  });

  it("does not overwrite an existing scriptOutput", () => {
    const merged = mergeCompletionResult(
      { output: "raw", scriptOutput: "already-promoted" },
      0,
    );
    expect(merged?.scriptOutput).toBe("already-promoted");
  });

  it("preserves unrelated keys the runtime wrote (e.g. metrics)", () => {
    const merged = mergeCompletionResult(
      { metrics: { duration: 5 }, condition: true },
      1,
    );
    expect(merged).toEqual({
      metrics: { duration: 5 },
      condition: true,
      exitCode: 1,
    });
  });

  it("returns undefined when there is nothing to persist", () => {
    expect(mergeCompletionResult({}, null)).toBeUndefined();
    expect(mergeCompletionResult(null, null)).toBeUndefined();
    expect(mergeCompletionResult(undefined, undefined)).toBeUndefined();
  });

  it("still records the exitCode when the result was otherwise empty", () => {
    expect(mergeCompletionResult({}, 1)).toEqual({ exitCode: 1 });
  });

  it("treats a false condition as a real value, not absence", () => {
    const merged = mergeCompletionResult({ condition: false }, 0);
    expect(merged?.condition).toBe(false);
  });
});
