/**
 * A workflow's graph as the API sends it, turned into what the canvas edits, and
 * whether a canvas has changed it. No React or React Flow runtime — types only.
 */
import type { Edge, Node } from "@xyflow/react";
import { ConnectionType, type EventType } from "@/shared/schema";
import {
  type AvailableEvent,
  withCurrentEventDetails,
} from "./canvas-transforms";

/** An event as the API sends it: listed by `events.getAll`, or in a workflow's node. */
export interface ApiEvent {
  id: number;
  name: string;
  type: EventType;
  description?: string | null;
  tags?: unknown;
  serverId?: number | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

/** The nodes and connections `workflows.getById` sends with a workflow. */
export interface StoredGraph {
  nodes: Array<{
    id: number;
    eventId: number;
    position_x: number;
    position_y: number;
    event?: ApiEvent | null | undefined;
  }>;
  connections: Array<{
    id: number;
    sourceNodeId: number;
    targetNodeId: number;
    connectionType?: string | null;
  }>;
}

export interface CanvasGraph {
  nodes: Node[];
  edges: Edge[];
}

/** What the canvas shows of an event. An empty description or tag list is left out. */
export function toAvailableEvent(event: ApiEvent): AvailableEvent {
  const available: AvailableEvent = {
    id: event.id,
    name: event.name,
    type: event.type,
  };
  if (event.description) available.description = event.description;
  const tags = Array.isArray(event.tags)
    ? event.tags.filter((tag): tag is string => typeof tag === "string")
    : [];
  if (tags.length > 0) available.tags = tags;
  if (event.serverId) available.serverId = event.serverId;
  if (event.createdAt != null) available.createdAt = event.createdAt;
  if (event.updatedAt != null) available.updatedAt = event.updatedAt;
  return available;
}

const nodeId = (id: number) => `node-${id}`;

/**
 * The stored graph as canvas nodes and edges. Each node is an event node carrying its
 * event's details, as the canvas would show them; a save only reads the event and the
 * position back. An edge refers to its nodes by these ids, which is how a save sends it.
 */
export function toCanvasGraph(stored: StoredGraph): CanvasGraph {
  const nodes: Node[] = stored.nodes.map((node) => ({
    id: nodeId(node.id),
    type: "eventNode",
    position: { x: node.position_x, y: node.position_y },
    data: { eventId: node.eventId, label: "", type: "", eventTypeIcon: "" },
  }));
  const events = stored.nodes.flatMap((node) =>
    node.event ? [toAvailableEvent(node.event)] : [],
  );

  return {
    nodes: withCurrentEventDetails(nodes, events),
    edges: stored.connections.map((connection) => ({
      id: `edge-${connection.id}`,
      source: nodeId(connection.sourceNodeId),
      target: nodeId(connection.targetNodeId),
      type: "connectionEdge",
      data: {
        connectionType: connection.connectionType ?? ConnectionType.ALWAYS,
      },
    })),
  };
}

/** What a save would store of a graph: each node's event and place, and how they join. */
function storedShape({ nodes, edges }: CanvasGraph): string {
  const nodeShapes = nodes.map((node) =>
    JSON.stringify([
      node.id,
      (node.data as { eventId?: unknown }).eventId,
      node.position.x,
      node.position.y,
    ]),
  );
  const edgeShapes = edges.map((edge) =>
    JSON.stringify([
      edge.source,
      edge.target,
      (edge.data as { connectionType?: unknown } | undefined)?.connectionType ??
        ConnectionType.ALWAYS,
    ]),
  );
  return JSON.stringify([nodeShapes.sort(), edgeShapes.sort()]);
}

/**
 * Whether saving `after` would store the same graph as `before`. What a node shows of
 * its event, whether something is selected, and how an edge is drawn aren't stored, so
 * they don't count, and neither does the order.
 */
export function isSameGraph(before: CanvasGraph, after: CanvasGraph): boolean {
  return storedShape(before) === storedShape(after);
}
