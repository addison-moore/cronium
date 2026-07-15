import { resolveWorkflowInput, type PredecessorResult } from "../resolve-input";

const results = (entries: Array<[number, PredecessorResult]>) =>
  new Map<number, PredecessorResult>(entries);

describe("resolveWorkflowInput", () => {
  it("start node (no incoming edge) receives the workflow trigger input", () => {
    expect(resolveWorkflowInput([], results([]), { trigger: 1 })).toEqual({
      trigger: 1,
    });
  });

  it("downstream node receives its predecessor's object output", () => {
    const out = resolveWorkflowInput(
      [{ sourceNodeId: 7 }],
      results([[7, { success: true, scriptOutput: { rows: [1, 2] } }]]),
      { trigger: 1 },
    );
    expect(out).toEqual({ rows: [1, 2] });
  });

  it("wraps a scalar predecessor output as { value } (M3)", () => {
    const out = resolveWorkflowInput(
      [{ sourceNodeId: 7 }],
      results([[7, { success: true, scriptOutput: "test output" }]]),
      {},
    );
    expect(out).toEqual({ value: "test output" });
  });

  it("downstream node whose predecessor emitted nothing receives {} — NOT the trigger input (M6)", () => {
    const out = resolveWorkflowInput(
      [{ sourceNodeId: 7 }],
      results([[7, { success: true, scriptOutput: undefined }]]),
      { trigger: 1 },
    );
    expect(out).toEqual({});
  });

  it("downstream node whose predecessor failed receives {} (M6)", () => {
    const out = resolveWorkflowInput(
      [{ sourceNodeId: 7 }],
      results([[7, { success: false, scriptOutput: { partial: true } }]]),
      { trigger: 1 },
    );
    expect(out).toEqual({});
  });

  it("treats null scriptOutput as no output", () => {
    const out = resolveWorkflowInput(
      [{ sourceNodeId: 7 }],
      results([[7, { success: true, scriptOutput: null }]]),
      { trigger: 1 },
    );
    expect(out).toEqual({});
  });
});
