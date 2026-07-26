import type { Connection } from "@xyflow/react";

import {
  buildActionEdge,
  buildActionNode,
  getExecutionOrder,
  validateFlow,
} from "../flow-graph";
import {
  type ActionConnection,
  type ActionNode,
  NODE_TEMPLATES,
  NodeType,
} from "../../types";

function makeNode(
  id: string,
  nodeType: NodeType,
  overrides: Partial<ActionNode["data"]> = {},
): ActionNode {
  return {
    id,
    type: "action",
    position: { x: 0, y: 0 },
    data: { label: id, nodeType, isConfigured: true, ...overrides },
  };
}

function makeEdge(source: string, target: string): ActionConnection {
  return { id: `${source}->${target}`, source, target, type: "action" };
}

describe("buildActionNode", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(1700000000000);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("assembles a node from the template with a time-derived id", () => {
    const node = buildActionNode(NodeType.ACTION, { x: 10, y: 20 });
    expect(node.id).toBe("ACTION-1700000000000");
    expect(node.type).toBe("action");
    expect(node.position).toEqual({ x: 10, y: 20 });
    expect(node.data.label).toBe(NODE_TEMPLATES[NodeType.ACTION].label);
    expect(node.data.description).toBe(
      NODE_TEMPLATES[NodeType.ACTION].description,
    );
    expect(node.data.nodeType).toBe(NodeType.ACTION);
    expect(node.data.id).toBe(node.id);
  });

  it("lets caller data override template defaults", () => {
    const node = buildActionNode(
      NodeType.TRIGGER,
      { x: 0, y: 0 },
      { label: "Custom Trigger", toolId: "slack" },
    );
    expect(node.data.label).toBe("Custom Trigger");
    expect(node.data.toolId).toBe("slack");
  });

  it("never lets caller data override nodeType or id", () => {
    const node = buildActionNode(
      NodeType.OUTPUT,
      { x: 0, y: 0 },
      { nodeType: NodeType.TRIGGER, id: "spoofed" },
    );
    expect(node.data.nodeType).toBe(NodeType.OUTPUT);
    expect(node.data.id).toBe("OUTPUT-1700000000000");
  });
});

describe("buildActionEdge", () => {
  it('assembles an "always" action edge from a connection', () => {
    jest.spyOn(Date, "now").mockReturnValue(42);
    try {
      const connection: Connection = {
        source: "a",
        target: "b",
        sourceHandle: null,
        targetHandle: null,
      };
      const edge = buildActionEdge(connection);
      expect(edge).toMatchObject({
        id: "edge-42",
        type: "action",
        source: "a",
        target: "b",
        data: { connectionType: "always" },
      });
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe("getExecutionOrder", () => {
  it("orders a linear chain source-first", () => {
    const nodes = [
      makeNode("out", NodeType.OUTPUT),
      makeNode("mid", NodeType.ACTION),
      makeNode("start", NodeType.TRIGGER),
    ];
    const edges = [makeEdge("start", "mid"), makeEdge("mid", "out")];
    expect(getExecutionOrder(nodes, edges)).toEqual(["start", "mid", "out"]);
  });

  it("visits all dependencies before a join node", () => {
    const nodes = [
      makeNode("t", NodeType.TRIGGER),
      makeNode("a", NodeType.ACTION),
      makeNode("b", NodeType.ACTION),
      makeNode("join", NodeType.OUTPUT),
    ];
    const edges = [
      makeEdge("t", "a"),
      makeEdge("t", "b"),
      makeEdge("a", "join"),
      makeEdge("b", "join"),
    ];
    const order = getExecutionOrder(nodes, edges);
    expect(order).toHaveLength(4);
    expect(order.indexOf("t")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("t")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("join"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("join"));
  });

  it("treats nodes without incoming edges as start points even without TRIGGER type", () => {
    const nodes = [
      makeNode("free", NodeType.ACTION),
      makeNode("next", NodeType.ACTION),
    ];
    const edges = [makeEdge("free", "next")];
    expect(getExecutionOrder(nodes, edges)).toEqual(["free", "next"]);
  });

  it("still emits every node exactly once for a cyclic graph (pinned quirk)", () => {
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const nodes = [
        makeNode("a", NodeType.ACTION),
        makeNode("b", NodeType.ACTION),
      ];
      const edges = [makeEdge("a", "b"), makeEdge("b", "a")];
      const order = getExecutionOrder(nodes, edges);
      expect(warnSpy).toHaveBeenCalledWith("Cycle detected in flow");
      // The cycle re-entry is skipped but both nodes are still emitted, so
      // the order length always equals the node count — see validateFlow.
      expect([...order].sort()).toEqual(["a", "b"]);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("validateFlow", () => {
  it("accepts a configured trigger→action→output chain", () => {
    const nodes = [
      makeNode("t", NodeType.TRIGGER),
      makeNode("a", NodeType.ACTION),
      makeNode("o", NodeType.OUTPUT),
    ];
    const edges = [makeEdge("t", "a"), makeEdge("a", "o")];
    expect(validateFlow(nodes, edges)).toEqual({ isValid: true, errors: [] });
  });

  it("requires a trigger node", () => {
    const nodes = [
      makeNode("a", NodeType.ACTION),
      makeNode("o", NodeType.OUTPUT),
    ];
    const edges = [makeEdge("a", "o")];
    const result = validateFlow(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Flow must have at least one trigger node");
  });

  it("requires an output node", () => {
    const nodes = [
      makeNode("t", NodeType.TRIGGER),
      makeNode("a", NodeType.ACTION),
    ];
    const edges = [makeEdge("t", "a")];
    const result = validateFlow(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Flow must have at least one output node");
  });

  it("reports disconnected nodes by label", () => {
    const nodes = [
      makeNode("t", NodeType.TRIGGER),
      makeNode("o", NodeType.OUTPUT),
      makeNode("lonely", NodeType.ACTION, { label: "Lonely Action" }),
    ];
    const edges = [makeEdge("t", "o")];
    const result = validateFlow(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Disconnected nodes found: Lonely Action");
  });

  it("reports unconfigured nodes by label", () => {
    const nodes = [
      makeNode("t", NodeType.TRIGGER, { isConfigured: false, label: "T" }),
      makeNode("o", NodeType.OUTPUT),
    ];
    const edges = [makeEdge("t", "o")];
    const result = validateFlow(nodes, edges);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Unconfigured nodes: T");
  });

  it("does NOT surface the cycle error even for a cyclic flow (pinned quirk)", () => {
    // getExecutionOrder emits every node once regardless of cycles, so the
    // `executionOrder.length !== nodes.length` check can never fire. Pinned
    // as documentation of the dead check, not as desired behavior.
    const warnSpy = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const nodes = [
        makeNode("t", NodeType.TRIGGER),
        makeNode("o", NodeType.OUTPUT),
      ];
      const edges = [makeEdge("t", "o"), makeEdge("o", "t")];
      const result = validateFlow(nodes, edges);
      expect(result.errors).not.toContain(
        "Flow contains cycles or unreachable nodes",
      );
      expect(result.isValid).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
