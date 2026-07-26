/**
 * Pure status-derivation and tree-layout logic for WorkflowExecutionGraph.
 * No React — plain data in, positioned nodes / SVG path strings out.
 */
import { LogStatus } from "@/shared/schema";

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    eventId: number;
    label: string;
    type: string;
    eventTypeIcon: string;
    description: string;
    tags?: string[];
    serverId?: number;
    serverName?: string;
    createdAt?: string | Date;
    updatedAt?: string | Date;
  };
}

export interface WorkflowConnection {
  id: string;
  source: string;
  target: string;
  data: {
    connectionType: string;
  };
}

export interface WorkflowExecutionEvent {
  id: number;
  nodeId: number;
  eventId: number;
  status: LogStatus;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  errorMessage: string | null;
  sequenceOrder: number;
}

export interface NodeWithStatus extends WorkflowNode {
  status: LogStatus;
  isCurrentlyExecuting: boolean;
  hasError: boolean;
  duration?: number | null;
  nodeId: number;
}

// Define type for layout nodes
export interface LayoutNode extends NodeWithStatus {
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
}

/**
 * Extract the numeric workflow-node id from a graph node id of the form
 * "node-123" (falls back to parsing the raw id).
 */
export function parseNodeNumericId(id: string): number {
  const nodeIdMatch = /node-(\d+)/.exec(id);
  return nodeIdMatch?.[1] ? parseInt(nodeIdMatch[1]) : parseInt(id);
}

/** Join graph nodes with their execution events to derive per-node status. */
export function deriveNodeStatuses(
  nodes: WorkflowNode[],
  executionEvents: WorkflowExecutionEvent[],
): NodeWithStatus[] {
  return nodes.map((node) => {
    const nodeId = parseNodeNumericId(node.id);
    const executionEvent = executionEvents.find(
      (event) => event.nodeId === nodeId,
    );

    let status = LogStatus.PENDING;
    let isCurrentlyExecuting = false;
    let hasError = false;
    let duration = null;

    if (executionEvent) {
      status = executionEvent.status;
      isCurrentlyExecuting = status === LogStatus.RUNNING;
      hasError = status === LogStatus.FAILURE;
      duration = executionEvent.duration ?? null;
    }

    return {
      ...node,
      nodeId,
      status,
      isCurrentlyExecuting,
      hasError,
      duration,
    };
  });
}

// Get status color for a node
export function getNodeStatusClasses(
  node: Pick<NodeWithStatus, "isCurrentlyExecuting" | "status">,
): string {
  if (node.isCurrentlyExecuting) {
    return "border-info bg-info/10 shadow-lg shadow-info/20";
  }

  switch (node.status) {
    case LogStatus.SUCCESS:
      return "border-success bg-success/10";
    case LogStatus.FAILURE:
      return "border-destructive bg-destructive/10";
    case LogStatus.RUNNING:
      return "border-info bg-info/10 shadow-lg shadow-info/20";
    default:
      return "border-border bg-muted/60";
  }
}

/** Build the curved SVG path for a connection between two positioned nodes. */
export function buildConnectionPath(
  sourceNode: LayoutNode,
  targetNode: LayoutNode,
  isHorizontalLayout: boolean,
): string {
  let x1, y1, x2, y2, path;

  if (isHorizontalLayout) {
    // Horizontal layout: connections go from right side to left side
    x1 = sourceNode.x + sourceNode.width;
    y1 = sourceNode.y + sourceNode.height / 2;
    x2 = targetNode.x;
    y2 = targetNode.y + targetNode.height / 2;

    // Create a curved horizontal path
    const midX = (x1 + x2) / 2;
    path = `M ${x1} ${y1} Q ${midX} ${y1} ${midX} ${(y1 + y2) / 2} Q ${midX} ${y2} ${x2} ${y2}`;
  } else {
    // Vertical layout: connections go from bottom to top
    x1 = sourceNode.x + sourceNode.width / 2;
    y1 = sourceNode.y + sourceNode.height;
    x2 = targetNode.x + targetNode.width / 2;
    y2 = targetNode.y;

    // Create a curved vertical path
    const midY = (y1 + y2) / 2;
    path = `M ${x1} ${y1} Q ${x1} ${midY} ${(x1 + x2) / 2} ${midY} Q ${x2} ${midY} ${x2} ${y2}`;
  }

  return path;
}

// Calculate layout positions for tree visualization
export function calculateExecutionLayout(
  nodesWithStatus: NodeWithStatus[],
  connections: WorkflowConnection[],
  isHorizontal = true,
): LayoutNode[] {
  if (nodesWithStatus.length === 0) return [];

  const nodeWidth = 140;
  const nodeHeight = 40;
  const spacing = isHorizontal ? 60 : 20;
  const levelSpacing = isHorizontal ? 180 : 60;

  // Build connection map for tree layout
  const connectionMap = new Map<string, string[]>();
  const incomingMap = new Map<string, string>();

  connections.forEach((conn) => {
    if (!connectionMap.has(conn.source)) {
      connectionMap.set(conn.source, []);
    }
    connectionMap.get(conn.source)!.push(conn.target);
    incomingMap.set(conn.target, conn.source);
  });

  // Find root nodes (no incoming connections)
  const rootNodes = nodesWithStatus.filter((node) => !incomingMap.has(node.id));

  // If no clear roots, treat all as roots (disconnected nodes)
  const startingNodes = rootNodes.length > 0 ? rootNodes : nodesWithStatus;

  const positioned = new Map<string, { x: number; y: number; level: number }>();
  const levelNodes = new Map<number, string[]>();
  const visited = new Set<string>();

  // BFS to assign levels
  const queue: { nodeId: string; level: number }[] = startingNodes.map(
    (node) => ({ nodeId: node.id, level: 0 }),
  );

  // Mark starting nodes as visited
  startingNodes.forEach((node) => visited.add(node.id));

  while (queue.length > 0) {
    const { nodeId, level } = queue.shift()!;

    if (positioned.has(nodeId)) continue;

    positioned.set(nodeId, { x: 0, y: 0, level });

    if (!levelNodes.has(level)) {
      levelNodes.set(level, []);
    }
    levelNodes.get(level)!.push(nodeId);

    // Add children to queue
    const children = connectionMap.get(nodeId) ?? [];
    children.forEach((childId) => {
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push({ nodeId: childId, level: level + 1 });
      }
    });
  }

  // Calculate positions for each level
  levelNodes.forEach((nodeIds, level) => {
    if (isHorizontal) {
      // Horizontal layout: levels go left to right, nodes in level go top to bottom
      const levelHeight =
        nodeIds.length * nodeHeight + (nodeIds.length - 1) * spacing;
      const startY = -levelHeight / 2;

      nodeIds.forEach((nodeId, index) => {
        const x = level * levelSpacing;
        const y = startY + index * (nodeHeight + spacing);
        positioned.set(nodeId, { x, y, level });
      });
    } else {
      // Vertical layout: levels go top to bottom, nodes in level go left to right
      const levelWidth =
        nodeIds.length * nodeWidth + (nodeIds.length - 1) * spacing;
      const startX = -levelWidth / 2;

      nodeIds.forEach((nodeId, index) => {
        const x = startX + index * (nodeWidth + spacing);
        const y = level * levelSpacing;
        positioned.set(nodeId, { x, y, level });
      });
    }
  });

  return nodesWithStatus.map((node) => {
    const pos = positioned.get(node.id) ?? { x: 0, y: 0, level: 0 };
    return {
      ...node,
      x: pos.x,
      y: pos.y,
      level: pos.level,
      width: nodeWidth,
      height: nodeHeight,
    };
  });
}

export interface CanvasBounds {
  canvasWidth: number;
  canvasHeight: number;
  offsetX: number;
  offsetY: number;
}

/** Bounding box and offsets used to size the SVG container around the tree. */
export function computeCanvasBounds(layoutNodes: LayoutNode[]): CanvasBounds {
  // Calculate canvas dimensions
  const minX =
    layoutNodes.length > 0 ? Math.min(...layoutNodes.map((n) => n.x)) : 0;
  const maxX =
    layoutNodes.length > 0
      ? Math.max(...layoutNodes.map((n) => n.x + n.width))
      : 800;
  const minY =
    layoutNodes.length > 0 ? Math.min(...layoutNodes.map((n) => n.y)) : 0;
  const maxY =
    layoutNodes.length > 0
      ? Math.max(...layoutNodes.map((n) => n.y + n.height))
      : 400;

  const padding = 20;
  const canvasWidth = Math.max(400, maxX - minX + padding * 2);
  const canvasHeight = Math.max(200, maxY - minY + padding * 2);
  const offsetX = -minX + padding;
  const offsetY = -minY + padding;

  return { canvasWidth, canvasHeight, offsetX, offsetY };
}
