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
