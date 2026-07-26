import { LogStatus } from "@/shared/schema";
import {
  type LayoutNode,
  type NodeWithStatus,
  type WorkflowConnection,
  type WorkflowExecutionEvent,
  type WorkflowNode,
  buildConnectionPath,
  calculateExecutionLayout,
  computeCanvasBounds,
  deriveNodeStatuses,
  getNodeStatusClasses,
  parseNodeNumericId,
} from "../execution-graph";

function makeNode(id: string, eventId = 1): WorkflowNode {
  return {
    id,
    type: "eventNode",
    position: { x: 0, y: 0 },
    data: {
      eventId,
      label: `Node ${id}`,
      type: "BASH",
      eventTypeIcon: "BASH",
      description: "",
    },
  };
}

function makeExecutionEvent(
  nodeId: number,
  status: LogStatus,
  duration: number | null = null,
): WorkflowExecutionEvent {
  return {
    id: nodeId * 100,
    nodeId,
    eventId: 1,
    status,
    startedAt: null,
    completedAt: null,
    duration,
    errorMessage: null,
    sequenceOrder: nodeId,
  };
}

function makeConnection(source: string, target: string): WorkflowConnection {
  return {
    id: `${source}-${target}`,
    source,
    target,
    data: { connectionType: "always" },
  };
}

function withStatus(node: WorkflowNode): NodeWithStatus {
  return {
    ...node,
    nodeId: parseNodeNumericId(node.id),
    status: LogStatus.PENDING,
    isCurrentlyExecuting: false,
    hasError: false,
    duration: null,
  };
}

describe("parseNodeNumericId", () => {
  it.each([
    { id: "node-42", expected: 42 },
    { id: "node-7-extra", expected: 7 },
    { id: "17", expected: 17 },
  ])("parses '$id' to $expected", ({ id, expected }) => {
    expect(parseNodeNumericId(id)).toBe(expected);
  });

  it("returns NaN for ids without a numeric component", () => {
    expect(parseNodeNumericId("canvas-node")).toBeNaN();
  });
});

describe("deriveNodeStatuses", () => {
  it("defaults nodes without execution events to pending", () => {
    const [derived] = deriveNodeStatuses([makeNode("node-1")], []);
    expect(derived).toMatchObject({
      nodeId: 1,
      status: LogStatus.PENDING,
      isCurrentlyExecuting: false,
      hasError: false,
      duration: null,
    });
  });

  it.each([
    {
      status: LogStatus.RUNNING,
      executing: true,
      hasError: false,
    },
    {
      status: LogStatus.FAILURE,
      executing: false,
      hasError: true,
    },
    {
      status: LogStatus.SUCCESS,
      executing: false,
      hasError: false,
    },
  ])(
    "flags $status events (executing=$executing, hasError=$hasError)",
    ({ status, executing, hasError }) => {
      const [derived] = deriveNodeStatuses(
        [makeNode("node-3")],
        [makeExecutionEvent(3, status, 1500)],
      );
      expect(derived).toMatchObject({
        status,
        isCurrentlyExecuting: executing,
        hasError,
        duration: 1500,
      });
    },
  );

  it("matches events by the numeric id embedded in the node id", () => {
    const derived = deriveNodeStatuses(
      [makeNode("node-1"), makeNode("node-2")],
      [makeExecutionEvent(2, LogStatus.SUCCESS)],
    );
    expect(derived[0]!.status).toBe(LogStatus.PENDING);
    expect(derived[1]!.status).toBe(LogStatus.SUCCESS);
  });
});

describe("calculateExecutionLayout", () => {
  it("returns an empty layout for no nodes", () => {
    expect(calculateExecutionLayout([], [], true)).toEqual([]);
  });

  it("lays out a horizontal chain left to right, one level per node", () => {
    const nodes = ["node-1", "node-2", "node-3"].map((id) =>
      withStatus(makeNode(id)),
    );
    const connections = [
      makeConnection("node-1", "node-2"),
      makeConnection("node-2", "node-3"),
    ];

    const layout = calculateExecutionLayout(nodes, connections, true);
    expect(
      layout.map((n) => ({ id: n.id, x: n.x, y: n.y, level: n.level })),
    ).toEqual([
      { id: "node-1", x: 0, y: -20, level: 0 },
      { id: "node-2", x: 180, y: -20, level: 1 },
      { id: "node-3", x: 360, y: -20, level: 2 },
    ]);
    expect(layout[0]).toMatchObject({ width: 140, height: 40 });
  });

  it("lays out a vertical chain top to bottom", () => {
    const nodes = ["node-1", "node-2"].map((id) => withStatus(makeNode(id)));
    const layout = calculateExecutionLayout(
      nodes,
      [makeConnection("node-1", "node-2")],
      false,
    );
    expect(layout.map((n) => ({ id: n.id, x: n.x, y: n.y }))).toEqual([
      { id: "node-1", x: -70, y: 0 },
      { id: "node-2", x: -70, y: 60 },
    ]);
  });

  it("stacks fan-out children within the same level (horizontal)", () => {
    const nodes = ["node-1", "node-2", "node-3"].map((id) =>
      withStatus(makeNode(id)),
    );
    const connections = [
      makeConnection("node-1", "node-2"),
      makeConnection("node-1", "node-3"),
    ];

    const layout = calculateExecutionLayout(nodes, connections, true);
    const byId = new Map(layout.map((n) => [n.id, n]));
    expect(byId.get("node-2")).toMatchObject({ x: 180, y: -70, level: 1 });
    expect(byId.get("node-3")).toMatchObject({ x: 180, y: 30, level: 1 });
  });

  it("treats disconnected nodes as roots at level 0", () => {
    const nodes = ["node-1", "node-2"].map((id) => withStatus(makeNode(id)));
    const layout = calculateExecutionLayout(nodes, [], true);
    expect(layout.every((n) => n.level === 0)).toBe(true);
    // Stacked vertically within the root level
    expect(layout.map((n) => n.y)).toEqual([-70, 30]);
  });

  it("falls back to all nodes as roots when every node has an incoming edge", () => {
    const nodes = ["node-1", "node-2"].map((id) => withStatus(makeNode(id)));
    const connections = [
      makeConnection("node-1", "node-2"),
      makeConnection("node-2", "node-1"),
    ];
    const layout = calculateExecutionLayout(nodes, connections, true);
    expect(layout).toHaveLength(2);
    expect(layout.every((n) => Number.isFinite(n.x))).toBe(true);
  });
});

describe("buildConnectionPath", () => {
  const source: LayoutNode = {
    ...withStatus(makeNode("node-1")),
    x: 0,
    y: 0,
    width: 140,
    height: 40,
    level: 0,
  };
  const target: LayoutNode = {
    ...withStatus(makeNode("node-2")),
    x: 180,
    y: 100,
    width: 140,
    height: 40,
    level: 1,
  };

  it("draws right-to-left curves in horizontal layout", () => {
    // x1=140, y1=20, x2=180, y2=120, midX=160
    expect(buildConnectionPath(source, target, true)).toBe(
      "M 140 20 Q 160 20 160 70 Q 160 120 180 120",
    );
  });

  it("draws bottom-to-top curves in vertical layout", () => {
    // x1=70, y1=40, x2=250, y2=100, midY=70
    expect(buildConnectionPath(source, target, false)).toBe(
      "M 70 40 Q 70 70 160 70 Q 250 70 250 100",
    );
  });
});

describe("computeCanvasBounds", () => {
  it("uses fallback dimensions for an empty layout", () => {
    expect(computeCanvasBounds([])).toEqual({
      canvasWidth: 840, // 800 + 2 * 20 padding
      canvasHeight: 440, // 400 + 2 * 20 padding
      offsetX: 20,
      offsetY: 20,
    });
  });

  it("pads the bounding box and offsets negative coordinates", () => {
    const nodes = [
      { x: -50, y: -30, width: 140, height: 40 },
      { x: 180, y: 100, width: 140, height: 40 },
    ] as LayoutNode[];
    expect(computeCanvasBounds(nodes)).toEqual({
      canvasWidth: 410, // (320 - -50) + 40
      canvasHeight: 210, // (140 - -30) + 40
      offsetX: 70, // -(-50) + 20
      offsetY: 50, // -(-30) + 20
    });
  });

  it("enforces the minimum canvas size", () => {
    const nodes = [{ x: 0, y: 0, width: 140, height: 40 }] as LayoutNode[];
    expect(computeCanvasBounds(nodes)).toEqual({
      canvasWidth: 400,
      canvasHeight: 200,
      offsetX: 20,
      offsetY: 20,
    });
  });
});

describe("getNodeStatusClasses", () => {
  it.each([
    {
      name: "currently executing wins over stored status",
      node: { isCurrentlyExecuting: true, status: LogStatus.SUCCESS },
      expected: "border-info bg-info/10 shadow-lg shadow-info/20",
    },
    {
      name: "success",
      node: { isCurrentlyExecuting: false, status: LogStatus.SUCCESS },
      expected: "border-success bg-success/10",
    },
    {
      name: "failure",
      node: { isCurrentlyExecuting: false, status: LogStatus.FAILURE },
      expected: "border-destructive bg-destructive/10",
    },
    {
      name: "running",
      node: { isCurrentlyExecuting: false, status: LogStatus.RUNNING },
      expected: "border-info bg-info/10 shadow-lg shadow-info/20",
    },
    {
      name: "pending falls through to the muted default",
      node: { isCurrentlyExecuting: false, status: LogStatus.PENDING },
      expected: "border-border bg-muted/60",
    },
  ])("$name", ({ node, expected }) => {
    expect(getNodeStatusClasses(node)).toBe(expected);
  });
});
