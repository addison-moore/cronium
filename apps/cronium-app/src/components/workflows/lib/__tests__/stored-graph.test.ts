import type { Edge, Node } from "@xyflow/react";
import { ConnectionType, EventType } from "@/shared/schema";
import {
  type ApiEvent,
  type CanvasGraph,
  type StoredGraph,
  isSameGraph,
  toAvailableEvent,
  toCanvasGraph,
} from "../stored-graph";

const CREATED_AT = new Date("2026-01-02T03:04:05.000Z");
const UPDATED_AT = new Date("2026-02-03T04:05:06.000Z");

const nightly: ApiEvent = {
  id: 42,
  name: "nightly",
  type: EventType.BASH,
  description: "Runs at night",
  tags: ["ops"],
  serverId: 7,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const weekly: ApiEvent = {
  id: 43,
  name: "weekly",
  type: EventType.PYTHON,
  description: null,
  tags: [],
  serverId: null,
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
};

const stored: StoredGraph = {
  nodes: [
    { id: 1, eventId: 42, position_x: 120, position_y: 90, event: nightly },
    { id: 2, eventId: 43, position_x: 420, position_y: 90, event: weekly },
  ],
  connections: [
    {
      id: 5,
      sourceNodeId: 1,
      targetNodeId: 2,
      connectionType: ConnectionType.ON_SUCCESS,
    },
  ],
};

describe("toAvailableEvent", () => {
  it("keeps what the canvas shows of an event", () => {
    expect(toAvailableEvent(nightly)).toEqual({
      id: 42,
      name: "nightly",
      type: EventType.BASH,
      description: "Runs at night",
      tags: ["ops"],
      serverId: 7,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
  });

  it("leaves out an empty description, tag list and server", () => {
    expect(toAvailableEvent(weekly)).toEqual({
      id: 43,
      name: "weekly",
      type: EventType.PYTHON,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
  });

  it("keeps only the tags that are text", () => {
    expect(
      toAvailableEvent({ ...nightly, tags: ["ops", 3, null] }).tags,
    ).toEqual(["ops"]);
    expect(toAvailableEvent({ ...nightly, tags: "ops" })).not.toHaveProperty(
      "tags",
    );
  });
});

describe("toCanvasGraph", () => {
  it("makes each stored node an event node, with its event's details", () => {
    const { nodes } = toCanvasGraph(stored);

    expect(nodes).toEqual([
      {
        id: "node-1",
        type: "eventNode",
        position: { x: 120, y: 90 },
        data: {
          eventId: 42,
          label: "nightly",
          type: EventType.BASH,
          eventTypeIcon: EventType.BASH,
          description: "Runs at night",
          tags: ["ops"],
          serverId: 7,
          serverName: undefined,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        },
      },
      {
        id: "node-2",
        type: "eventNode",
        position: { x: 420, y: 90 },
        data: {
          eventId: 43,
          label: "weekly",
          type: EventType.PYTHON,
          eventTypeIcon: EventType.PYTHON,
          description: "",
          tags: [],
          serverId: undefined,
          serverName: undefined,
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        },
      },
    ]);
  });

  it("joins edges to those nodes, keeping the connection type", () => {
    expect(toCanvasGraph(stored).edges).toEqual([
      {
        id: "edge-5",
        source: "node-1",
        target: "node-2",
        type: "connectionEdge",
        data: { connectionType: ConnectionType.ON_SUCCESS },
      },
    ]);
  });

  it("reads a connection with no type as Always", () => {
    const { edges } = toCanvasGraph({
      ...stored,
      connections: [{ id: 5, sourceNodeId: 1, targetNodeId: 2 }],
    });
    expect(edges[0]?.data).toEqual({ connectionType: ConnectionType.ALWAYS });
  });

  it("keeps a node whose event didn't come with it", () => {
    const { nodes } = toCanvasGraph({
      nodes: [{ id: 1, eventId: 42, position_x: 0, position_y: 0 }],
      connections: [],
    });
    expect(nodes[0]?.data).toEqual({
      eventId: 42,
      label: "",
      type: "",
      eventTypeIcon: "",
    });
  });

  it("is empty for a workflow with no nodes", () => {
    expect(toCanvasGraph({ nodes: [], connections: [] })).toEqual({
      nodes: [],
      edges: [],
    });
  });
});

describe("isSameGraph", () => {
  const before = toCanvasGraph(stored);
  const [first, second] = before.nodes as [Node, Node];
  const [edge] = before.edges as [Edge];
  const graph = (nodes: Node[], edges: Edge[]): CanvasGraph => ({
    nodes,
    edges,
  });

  it("is the same graph as it came in", () => {
    expect(isSameGraph(before, toCanvasGraph(stored))).toBe(true);
  });

  it("ignores what isn't stored: order, selection, size, details, drawing", () => {
    const after = graph(
      [
        { ...second, selected: true, measured: { width: 192, height: 60 } },
        { ...first, data: { ...first.data, label: "renamed", tags: [] } },
      ],
      [
        {
          ...edge,
          id: "e-node-1-node-2",
          animated: true,
          sourceHandle: null,
          targetHandle: null,
          selected: true,
        },
      ],
    );
    expect(isSameGraph(before, after)).toBe(true);
  });

  it.each<[string, CanvasGraph]>([
    [
      "a node moved",
      graph([{ ...first, position: { x: 135, y: 90 } }, second], [edge]),
    ],
    [
      "a node on another event",
      graph(
        [{ ...first, data: { ...first.data, eventId: 44 } }, second],
        [edge],
      ),
    ],
    ["a node removed", graph([first], [])],
    [
      "a node added",
      graph([first, second, { ...second, id: "event-44-1" }], [edge]),
    ],
    ["a connection removed", graph([first, second], [])],
    [
      "a connection's type changed",
      graph(
        [first, second],
        [{ ...edge, data: { connectionType: ConnectionType.ON_FAILURE } }],
      ),
    ],
    [
      "a connection turned around",
      graph([first, second], [{ ...edge, source: "node-2", target: "node-1" }]),
    ],
  ])("sees %s", (_change, after) => {
    expect(isSameGraph(before, after)).toBe(false);
  });

  it("reads an edge with no type as Always", () => {
    const always = graph(
      [first, second],
      [{ ...edge, data: { connectionType: ConnectionType.ALWAYS } }],
    );
    expect(
      isSameGraph(
        always,
        graph([first, second], [{ ...edge, data: undefined }]),
      ),
    ).toBe(true);
  });
});
