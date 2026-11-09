import type { Connection, Edge, Node } from "@xyflow/react";
import { ConnectionType, EventType } from "@/shared/schema";
import {
  type AvailableEvent,
  buildConnectionEdge,
  buildEventNode,
  ensureEdgeConnectionType,
  filterAvailableEvents,
  normalizeEdge,
  normalizeEdges,
  withCurrentEventDetails,
  workflowGraphKey,
} from "../canvas-transforms";

const events: AvailableEvent[] = [
  {
    id: 1,
    name: "Deploy API",
    type: EventType.BASH,
    description: "Ships the backend",
    tags: ["deploy", "backend"],
  },
  {
    id: 2,
    name: "Nightly report",
    type: EventType.PYTHON,
    description: undefined,
    tags: undefined,
  },
  {
    id: 3,
    name: "Ping",
    type: EventType.HTTP_REQUEST,
    description: "Health check",
    tags: ["monitoring"],
  },
];

describe("filterAvailableEvents", () => {
  it("returns everything for an empty query", () => {
    expect(filterAvailableEvents(events, "")).toEqual(events);
  });

  it.each([
    { query: "deploy api", expected: [1] }, // name, case-insensitive
    { query: "BACKEND", expected: [1] }, // description + tag
    { query: "monitoring", expected: [3] }, // tag only
    { query: "health", expected: [3] }, // description only
    { query: "nothing-matches", expected: [] },
  ])("query '$query' matches ids $expected", ({ query, expected }) => {
    expect(filterAvailableEvents(events, query).map((e) => e.id)).toEqual(
      expected,
    );
  });

  it("handles events without description or tags", () => {
    expect(filterAvailableEvents(events, "nightly").map((e) => e.id)).toEqual([
      2,
    ]);
  });
});

describe("normalizeEdge / normalizeEdges", () => {
  it("fills in missing canvas defaults", () => {
    const edge = { id: "e1", source: "a", target: "b" } as Edge;
    expect(normalizeEdge(edge)).toEqual({
      id: "e1",
      source: "a",
      target: "b",
      type: "connectionEdge",
      data: { connectionType: ConnectionType.ALWAYS },
      animated: true,
      sourceHandle: null,
      targetHandle: null,
    });
  });

  it("keeps explicit values, including animated: false", () => {
    const edge: Edge = {
      id: "e1",
      source: "a",
      target: "b",
      type: "custom",
      data: { connectionType: ConnectionType.ON_FAILURE },
      animated: false,
      sourceHandle: "out",
      targetHandle: "in",
    };
    expect(normalizeEdge(edge)).toEqual(edge);
  });

  it("normalizes each edge in a list", () => {
    const result = normalizeEdges([
      { id: "e1", source: "a", target: "b" } as Edge,
      { id: "e2", source: "b", target: "c" } as Edge,
    ]);
    expect(result).toHaveLength(2);
    for (const edge of result) {
      expect(edge.type).toBe("connectionEdge");
      expect(edge.data).toEqual({ connectionType: ConnectionType.ALWAYS });
    }
  });
});

describe("ensureEdgeConnectionType", () => {
  it("adds a default connectionType while keeping other data keys", () => {
    const edge = {
      id: "e1",
      source: "a",
      target: "b",
      data: { note: "keep me" },
    } as Edge;
    expect(ensureEdgeConnectionType(edge).data).toEqual({
      note: "keep me",
      connectionType: ConnectionType.ALWAYS,
    });
  });

  it("preserves an existing connectionType", () => {
    const edge = {
      id: "e1",
      source: "a",
      target: "b",
      data: { connectionType: ConnectionType.ON_SUCCESS },
    } as Edge;
    expect(ensureEdgeConnectionType(edge).data).toEqual({
      connectionType: ConnectionType.ON_SUCCESS,
    });
  });

  it("fills the same structural defaults as normalizeEdge", () => {
    const result = ensureEdgeConnectionType({
      id: "e1",
      source: "a",
      target: "b",
    } as Edge);
    expect(result.type).toBe("connectionEdge");
    expect(result.animated).toBe(true);
    expect(result.sourceHandle).toBeNull();
    expect(result.targetHandle).toBeNull();
  });
});

describe("buildConnectionEdge", () => {
  it("creates a fully-populated connectionEdge from a connection", () => {
    const connection: Connection = {
      source: "node-1",
      target: "node-2",
      sourceHandle: null,
      targetHandle: null,
    };
    expect(buildConnectionEdge(connection)).toEqual({
      id: "e-node-1-node-2",
      source: "node-1",
      target: "node-2",
      type: "connectionEdge",
      data: { connectionType: ConnectionType.ALWAYS },
      animated: true,
      sourceHandle: null,
      targetHandle: null,
    });
  });

  it("keeps explicit handles from the connection", () => {
    const connection: Connection = {
      source: "a",
      target: "b",
      sourceHandle: "out",
      targetHandle: "in",
    };
    const edge = buildConnectionEdge(connection);
    expect(edge.sourceHandle).toBe("out");
    expect(edge.targetHandle).toBe("in");
  });
});

describe("buildEventNode", () => {
  it("centers the node on the cursor and copies event data", () => {
    const event = events[0]!;
    const node = buildEventNode(event, { x: 200, y: 100 }, "event-1-42");
    expect(node).toEqual({
      id: "event-1-42",
      type: "eventNode",
      position: { x: 104, y: 70 }, // 200 - 96, 100 - 30
      data: {
        eventId: 1,
        label: "Deploy API",
        type: EventType.BASH,
        eventTypeIcon: EventType.BASH,
        description: "",
        tags: [],
      },
    });
  });

  it("does not mutate the drop position", () => {
    const position = { x: 10, y: 20 };
    buildEventNode(events[1]!, position, "id");
    expect(position).toEqual({ x: 10, y: 20 });
  });
});

describe("withCurrentEventDetails", () => {
  const createdAt = new Date("2026-01-02T03:04:05.000Z");
  const updatedAt = new Date("2026-11-06T07:08:09.000Z");
  const event: AvailableEvent = {
    id: 7,
    name: "Renamed",
    type: EventType.PYTHON,
    description: "After",
    tags: ["after"],
    serverId: 3,
    createdAt,
    updatedAt,
  };
  const showing = {
    eventId: 7,
    label: "Renamed",
    type: EventType.PYTHON,
    eventTypeIcon: EventType.PYTHON,
    description: "After",
    tags: ["after"],
    serverId: 3,
    createdAt,
    updatedAt,
  };
  const nodeWith = (data: Record<string, unknown>) => ({
    id: "node-1",
    position: { x: 10, y: 20 },
    data,
  });

  it("gives a node what its event says now", () => {
    const node = nodeWith({
      eventId: 7,
      label: "Nightly",
      type: EventType.BASH,
      eventTypeIcon: EventType.BASH,
      description: "Before",
      tags: ["before"],
    });

    expect(withCurrentEventDetails([node], [event])[0]?.data).toEqual(showing);
  });

  it("notices a change to any one detail, not only the name", () => {
    const changed = [
      { description: "Before" },
      { tags: ["before"] },
      { serverId: 4 },
      { updatedAt: new Date("2026-02-03T00:00:00.000Z") },
    ];

    for (const fields of changed) {
      const [node] = withCurrentEventDetails(
        [nodeWith({ ...showing, ...fields })],
        [event],
      );
      expect(node?.data).toEqual(showing);
    }
  });

  it("keeps everything else about the node", () => {
    const node = {
      ...nodeWith({ eventId: 7, label: "Nightly", extra: "kept" }),
      selected: true,
      measured: { width: 192, height: 60 },
    };

    expect(withCurrentEventDetails([node], [event])[0]).toMatchObject({
      id: "node-1",
      position: { x: 10, y: 20 },
      selected: true,
      measured: { width: 192, height: 60 },
      data: { extra: "kept", label: "Renamed" },
    });
  });

  it("clears what the event no longer has", () => {
    const bare: AvailableEvent = {
      id: 7,
      name: "Renamed",
      type: EventType.PYTHON,
    };

    const [node] = withCurrentEventDetails([nodeWith(showing)], [bare]);

    expect(node?.data).toMatchObject({ description: "", tags: [] });
    expect(node?.data.serverId).toBeUndefined();
    expect(node?.data.updatedAt).toBeUndefined();
  });

  it("leaves a node alone when its event isn't in the list", () => {
    const node = nodeWith({ eventId: 8, label: "Past the list's limit" });

    expect(withCurrentEventDetails([node], [event])[0]).toBe(node);
  });

  it("leaves a node with no event alone", () => {
    const node = nodeWith({ label: "No event" });

    expect(withCurrentEventDetails([node], [event])[0]).toBe(node);
  });

  it("keeps the same object for a node that already matches", () => {
    const node = nodeWith(showing);

    expect(withCurrentEventDetails([node], [event])[0]).toBe(node);
  });

  it("doesn't count a date from the undo history, which is a string, as a change", () => {
    const node = nodeWith(
      JSON.parse(JSON.stringify(showing)) as typeof showing,
    );

    expect(withCurrentEventDetails([node], [event])[0]).toBe(node);
  });

  it("doesn't count a missing server as a change, whichever way it's missing", () => {
    const { serverId: _serverId, ...withoutServer } = event;
    const node = nodeWith({ ...showing, serverId: null });

    expect(withCurrentEventDetails([node], [withoutServer])[0]).toBe(node);
  });

  it("doesn't change the node it was given", () => {
    const node = nodeWith({ eventId: 7, label: "Nightly" });

    withCurrentEventDetails([node], [event]);

    expect(node.data).toEqual({ eventId: 7, label: "Nightly" });
  });
});

describe("workflowGraphKey", () => {
  const node = (id: string, eventId: number, x: number, y = 0): Node => ({
    id,
    position: { x, y },
    data: { eventId },
  });
  const edge = (
    source: string,
    target: string,
    connectionType?: ConnectionType,
  ): Edge => ({
    id: `${source}-${target}`,
    source,
    target,
    ...(connectionType && { data: { connectionType } }),
  });

  const nodes = [node("a", 1, 0), node("b", 2, 300)];
  const edges = [edge("a", "b", ConnectionType.ON_SUCCESS)];
  const key = workflowGraphKey(nodes, edges);

  it("is the same under the new ids a save gives every node", () => {
    expect(
      workflowGraphKey(
        [node("node-7", 1, 0), node("node-8", 2, 300)],
        [edge("node-7", "node-8", ConnectionType.ON_SUCCESS)],
      ),
    ).toBe(key);
  });

  it("doesn't depend on the order nodes and connections come in", () => {
    const three = [node("a", 1, 0), node("b", 2, 300), node("c", 3, 600)];
    const both = [edge("a", "b"), edge("a", "c")];

    expect(workflowGraphKey([...three].reverse(), [...both].reverse())).toBe(
      workflowGraphKey(three, both),
    );
  });

  it("ignores what a node shows about its event, and React Flow's own fields", () => {
    const shown: Node = {
      ...node("a", 1, 0),
      data: { eventId: 1, label: "Renamed", description: "New", tags: ["x"] },
      selected: true,
      dragging: false,
      measured: { width: 192, height: 60 },
    };
    const drawn: Edge = {
      ...edge("a", "b", ConnectionType.ON_SUCCESS),
      id: "e-a-b",
      animated: true,
      selected: true,
    };

    expect(workflowGraphKey([shown, nodes[1]!], [drawn])).toBe(key);
  });

  it("takes a connection with no condition as Always, as the server does", () => {
    expect(workflowGraphKey(nodes, [edge("a", "b")])).toBe(
      workflowGraphKey(nodes, [edge("a", "b", ConnectionType.ALWAYS)]),
    );
  });

  it("leaves out a connection to a node that isn't there, which a save drops", () => {
    expect(workflowGraphKey(nodes, [...edges, edge("a", "gone")])).toBe(key);
  });

  it.each<[string, Node[], Edge[]]>([
    ["a node added", [...nodes, node("c", 3, 600)], edges],
    ["a node removed", [nodes[0]!], []],
    ["a node moved", [node("a", 1, 15), nodes[1]!], edges],
    ["a node's event", [node("a", 3, 0), nodes[1]!], edges],
    ["a connection removed", nodes, []],
    [
      "a connection turned round",
      nodes,
      [edge("b", "a", ConnectionType.ON_SUCCESS)],
    ],
    [
      "a connection's condition",
      nodes,
      [edge("a", "b", ConnectionType.ON_FAILURE)],
    ],
  ])("changes with %s", (_change, changedNodes, changedEdges) => {
    expect(workflowGraphKey(changedNodes, changedEdges)).not.toBe(key);
  });

  it("tells apart which of two nodes on one event a connection leaves from", () => {
    const twins = [node("a", 1, 0), node("b", 1, 300), node("c", 2, 600)];

    expect(workflowGraphKey(twins, [edge("a", "c")])).not.toBe(
      workflowGraphKey(twins, [edge("b", "c")]),
    );
  });
});
