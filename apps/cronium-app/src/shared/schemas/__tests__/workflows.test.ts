import { updateWorkflowSchema } from "../workflows";
import { ConnectionType } from "../../schema";

const edge = (id: string, source: string, target: string) => ({
  id,
  source,
  target,
  type: "connectionEdge" as const,
  data: { connectionType: ConnectionType.ALWAYS },
});

const node = (id: string, eventId: number) => ({
  id,
  type: "eventNode" as const,
  position: { x: 0, y: 0 },
  data: {
    eventId,
    label: `node-${id}`,
    type: "BASH",
    eventTypeIcon: "terminal",
    tags: [],
  },
});

describe("workflow single-predecessor (no fan-in) rule", () => {
  it("rejects two edges pointing at the same node (fan-in)", () => {
    const result = updateWorkflowSchema.safeParse({
      id: 1,
      nodes: [node("a", 11), node("b", 12), node("c", 13)],
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
      nodes: [node("a", 11), node("b", 12), node("c", 13)],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c")],
    });
    expect(result.success).toBe(true);
  });

  it("allows fan-OUT (one source → many targets via conditional edges)", () => {
    const result = updateWorkflowSchema.safeParse({
      id: 1,
      nodes: [node("a", 11), node("b", 12), node("c", 13)],
      edges: [edge("e1", "a", "b"), edge("e2", "a", "c")],
    });
    expect(result.success).toBe(true);
  });

  it("is a no-op when edges are not part of the update", () => {
    const result = updateWorkflowSchema.safeParse({ id: 1, name: "renamed" });
    expect(result.success).toBe(true);
  });
});

describe("nodes and edges must be provided together (FINDINGS #19)", () => {
  // Edge source/target are ReactFlow ids that only exist in the submitted
  // nodes array, so a nodes-only update would silently drop every connection
  // and an edges-only update could never be applied.
  it("rejects a nodes-only update", () => {
    const result = updateWorkflowSchema.safeParse({
      id: 1,
      nodes: [node("a", 11)],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => /together/i.test(i.message))).toBe(
        true,
      );
    }
  });

  it("rejects an edges-only update (even an empty edges array)", () => {
    for (const edges of [[edge("e1", "a", "b")], []]) {
      const result = updateWorkflowSchema.safeParse({ id: 1, edges });
      expect(result.success).toBe(false);
    }
  });

  it("accepts both together, including an empty graph", () => {
    expect(
      updateWorkflowSchema.safeParse({
        id: 1,
        nodes: [node("a", 11), node("b", 12)],
        edges: [edge("e1", "a", "b")],
      }).success,
    ).toBe(true);
    expect(
      updateWorkflowSchema.safeParse({ id: 1, nodes: [], edges: [] }).success,
    ).toBe(true);
  });
});
