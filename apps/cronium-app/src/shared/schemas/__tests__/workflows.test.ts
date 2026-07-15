import { updateWorkflowSchema } from "../workflows";
import { ConnectionType } from "../../schema";

const edge = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  type: "connectionEdge" as const,
  data: { connectionType: ConnectionType.ALWAYS },
});

describe("workflow single-predecessor (no fan-in) rule", () => {
  it("rejects two edges pointing at the same node (fan-in)", () => {
    const result = updateWorkflowSchema.safeParse({
      id: 1,
      edges: [edge("e1", "a", "c"), edge("e2", "b", "c")],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /fan-in/i.test(i.message))).toBe(
        true,
      );
    }
  });

  it("allows a linear chain (each node has one incoming edge)", () => {
    const result = updateWorkflowSchema.safeParse({
      id: 1,
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c")],
    });
    expect(result.success).toBe(true);
  });

  it("allows fan-OUT (one source → many targets via conditional edges)", () => {
    const result = updateWorkflowSchema.safeParse({
      id: 1,
      edges: [edge("e1", "a", "b"), edge("e2", "a", "c")],
    });
    expect(result.success).toBe(true);
  });

  it("is a no-op when edges are not part of the update", () => {
    const result = updateWorkflowSchema.safeParse({ id: 1, name: "renamed" });
    expect(result.success).toBe(true);
  });
});
