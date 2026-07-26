import {
  validateWorkflowStructure,
  type WorkflowGraphEdge,
  type WorkflowGraphNode,
} from "../workflow-structure";

const nodes = (...ids: string[]): WorkflowGraphNode[] =>
  ids.map((id) => ({ id }));

const edge = (source: string, target: string): WorkflowGraphEdge => ({
  source,
  target,
});

describe("validateWorkflowStructure", () => {
  describe("valid graphs", () => {
    const cases: Array<{
      name: string;
      nodes: WorkflowGraphNode[];
      edges: WorkflowGraphEdge[];
    }> = [
      { name: "empty graph", nodes: [], edges: [] },
      { name: "single node, no edges", nodes: nodes("a"), edges: [] },
      {
        name: "linear chain",
        nodes: nodes("a", "b", "c"),
        edges: [edge("a", "b"), edge("b", "c")],
      },
      {
        name: "fan-out from one node",
        nodes: nodes("a", "b", "c"),
        edges: [edge("a", "b"), edge("a", "c")],
      },
      {
        name: "two disconnected chains",
        nodes: nodes("a", "b", "c", "d"),
        edges: [edge("a", "b"), edge("c", "d")],
      },
    ];

    it.each(cases)("accepts $name", ({ nodes, edges }) => {
      expect(validateWorkflowStructure(nodes, edges)).toEqual({
        isValid: true,
      });
    });
  });

  describe("fan-in (merge) prevention", () => {
    it("rejects two existing edges that target the same node", () => {
      const result = validateWorkflowStructure(nodes("a", "b", "c"), [
        edge("a", "c"),
        edge("b", "c"),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.type).toBe("merge");
      expect(result.error).toMatch(/one input connection/);
    });

    it("rejects a new connection that would create a fan-in", () => {
      const result = validateWorkflowStructure(
        nodes("a", "b", "c"),
        [edge("a", "c")],
        edge("b", "c"),
      );
      expect(result.isValid).toBe(false);
      expect(result.type).toBe("merge");
    });

    it("rejects a duplicate of an existing connection (counted as two inputs)", () => {
      const result = validateWorkflowStructure(
        nodes("a", "b"),
        [edge("a", "b")],
        edge("a", "b"),
      );
      expect(result.isValid).toBe(false);
      expect(result.type).toBe("merge");
    });
  });

  describe("cycle prevention", () => {
    it("rejects a direct two-node cycle", () => {
      const result = validateWorkflowStructure(nodes("a", "b"), [
        edge("a", "b"),
        edge("b", "a"),
      ]);
      expect(result.isValid).toBe(false);
      expect(result.type).toBe("cycle");
      expect(result.error).toMatch(/cycle detected/i);
    });

    it("rejects a self-loop introduced by a new connection", () => {
      const result = validateWorkflowStructure(nodes("a"), [], edge("a", "a"));
      expect(result.isValid).toBe(false);
      expect(result.type).toBe("cycle");
    });

    it("rejects a longer cycle reached through a chain", () => {
      const result = validateWorkflowStructure(
        nodes("a", "b", "c"),
        [edge("a", "b"), edge("b", "c")],
        edge("c", "a"),
      );
      expect(result.isValid).toBe(false);
      expect(result.type).toBe("cycle");
    });

    it("accepts a new connection that extends a chain without cycling", () => {
      const result = validateWorkflowStructure(
        nodes("a", "b", "c"),
        [edge("a", "b")],
        edge("b", "c"),
      );
      expect(result).toEqual({ isValid: true });
    });
  });

  it("reports fan-in before cycles when both are present", () => {
    // a -> b, b -> a, a -> b duplicated via fan-in on "a": merge is checked first
    const result = validateWorkflowStructure(nodes("a", "b", "c"), [
      edge("a", "b"),
      edge("c", "b"),
      edge("b", "a"),
    ]);
    expect(result.type).toBe("merge");
  });
});
