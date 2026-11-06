/**
 * Pure node/edge construction and normalization helpers for the workflow
 * canvas (WorkflowCanvas). No React or ReactFlow runtime — types only.
 */
import type { Connection, Edge, Node } from "@xyflow/react";
import { ConnectionType } from "@/shared/schema";
import type { EventType } from "@/shared/schema";

export interface AvailableEvent {
  id: number;
  name: string;
  type: EventType;
  description?: string;
  tags?: string[];
  serverId?: number;
  serverName?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

/** Sidebar search: match on event name, description, or any tag (case-insensitive). */
export function filterAvailableEvents(
  events: AvailableEvent[],
  searchQuery: string,
): AvailableEvent[] {
  return events.filter(
    (event) =>
      event.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (event.description?.toLowerCase().includes(searchQuery.toLowerCase()) ??
        false) ||
      (event.tags?.some((tag: string) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase()),
      ) ??
        false),
  );
}

/**
 * Nodes showing what their events say now. A node's own copy dates from when it was
 * read or dropped on the canvas, and the canvas's undo history holds older ones, so
 * this is for display and isn't written back: an event's details aren't a change to the
 * workflow. A node that already matches stays the same object, because React Flow
 * rebuilds a node it's handed as a new one.
 */
export function withCurrentEventDetails<N extends { data: object }>(
  nodes: N[],
  events: AvailableEvent[],
): N[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));

  return nodes.map((node) => {
    const data = node.data as Record<string, unknown>;
    const event = eventsById.get(data.eventId as number);
    if (!event) return node;

    // An event says nothing about a field it doesn't have, so that clears the node's.
    const details = {
      label: event.name,
      type: event.type,
      eventTypeIcon: event.type,
      description: event.description ?? "",
      tags: event.tags ?? [],
      serverId: event.serverId,
      serverName: event.serverName,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
    // As JSON, because a date is a Date from the API and a string from the undo history.
    const matches = Object.entries(details).every(
      ([key, value]) =>
        JSON.stringify(data[key] ?? null) === JSON.stringify(value ?? null),
    );
    return matches ? node : { ...node, data: { ...data, ...details } };
  });
}

/** Fill in the edge properties the canvas requires when they are missing. */
export function normalizeEdge(edge: Edge): Edge {
  return {
    ...edge,
    type: edge.type ?? "connectionEdge",
    data: edge.data ?? { connectionType: ConnectionType.ALWAYS },
    animated: edge.animated ?? true,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
  };
}

/** Normalize a list of edges (see {@link normalizeEdge}). */
export function normalizeEdges(edges: Edge[]): Edge[] {
  return edges.map(normalizeEdge);
}

/**
 * Normalization used before `addEdge`: unlike {@link normalizeEdge} this keeps
 * the existing `data` object but guarantees `data.connectionType` is present.
 */
export function ensureEdgeConnectionType(edge: Edge): Edge {
  return {
    ...edge,
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type ?? "connectionEdge",
    data: {
      ...edge.data,
      connectionType: edge.data?.connectionType ?? ConnectionType.ALWAYS,
    },
    animated: edge.animated ?? true,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
  };
}

/** Build the edge created when the user connects two nodes on the canvas. */
export function buildConnectionEdge(connection: Connection): Edge {
  return {
    ...connection,
    id: `e-${connection.source}-${connection.target}`,
    type: "connectionEdge", // Ensure type is always defined as a string
    data: { connectionType: ConnectionType.ALWAYS },
    animated: true,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle ?? null,
    targetHandle: connection.targetHandle ?? null,
  };
}

/**
 * Build the ReactFlow node for an event dropped on the canvas. The drop
 * position is offset so the node (~192px wide, ~60px tall) is centered on the
 * cursor.
 */
export function buildEventNode(
  eventData: AvailableEvent,
  dropPosition: { x: number; y: number },
  nodeId: string,
): Node {
  return {
    id: nodeId,
    type: "eventNode",
    position: { x: dropPosition.x - 96, y: dropPosition.y - 30 },
    data: {
      eventId: eventData.id,
      label: eventData.name,
      type: eventData.type,
      eventTypeIcon: eventData.type,
      description: "",
      tags: [],
    },
  };
}
