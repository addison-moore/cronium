"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  applyNodeChanges,
  ConnectionLineType,
} from "@xyflow/react";
import type {
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
  NodeTypes,
  EdgeTypes,
  ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertCircle,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Undo,
  RotateCcw,
  Info,
  Search,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@cronium/ui";
import { toast } from "@cronium/ui";
import { ConnectionType } from "@/shared/schema";
import { EventTypeIcon } from "@/components/ui/event-type-icon";
import { EventDetailsPopover } from "@/components/ui/event-details-popover";

// Validation functions for workflow integrity
const validateWorkflowStructure = (
  nodes: Node[],
  edges: Edge[],
  newConnection?: Connection,
) => {
  const allEdges = newConnection
    ? [
        ...edges,
        {
          ...newConnection,
          id: `temp-${newConnection.source}-${newConnection.target}`,
        },
      ]
    : edges;

  // Check for multiple inputs to a single node (merge prevention)
  const targetNodes = new Map<string, string[]>();
  allEdges.forEach((edge) => {
    const target = edge.target;
    if (!targetNodes.has(target)) {
      targetNodes.set(target, []);
    }
    targetNodes.get(target)!.push(edge.source);
  });

  // Find nodes with multiple inputs
  const mergeViolations = Array.from(targetNodes.entries()).filter(
    ([_target, sources]) => sources.length > 1,
  );
  if (mergeViolations.length > 0) {
    return {
      isValid: false,
      error:
        "Workflow branching violation: Multiple nodes cannot connect to the same downstream node. Each node can only have one input connection.",
      type: "merge",
    };
  }

  // Check for cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const hasCycle = (nodeId: string): boolean => {
    if (recursionStack.has(nodeId)) {
      return true; // Back edge found - cycle detected
    }
    if (visited.has(nodeId)) {
      return false; // Already processed
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    // Check all outgoing edges
    const outgoingEdges = allEdges.filter((edge) => edge.source === nodeId);
    for (const edge of outgoingEdges) {
      if (hasCycle(edge.target)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  };

  // Check for cycles starting from all nodes
  for (const node of nodes) {
    if (!visited.has(node.id) && hasCycle(node.id)) {
      return {
        isValid: false,
        error:
          "Workflow cycle detected: Workflows cannot be cyclical as this would create infinite loops. Please remove connections that create circular dependencies.",
        type: "cycle",
      };
    }
  }

  return { isValid: true };
};

// Import custom nodes
import EventNode from "./nodes/EventNode";
import ConnectionEdge from "./edges/ConnectionEdge";
import { Spinner } from "@cronium/ui";
import type { EventType } from "@/shared/schema";

// Event type icon mapping - now using consistent icons

// Type definitions for custom nodes and edges
const eventNodeType: NodeTypes = { eventNode: EventNode };
const connectionEdgeType: EdgeTypes = { connectionEdge: ConnectionEdge };

interface AvailableEvent {
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

export interface WorkflowCanvasProps {
  availableEvents?: AvailableEvent[];
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onChange?: (nodes: Node[], edges: Edge[]) => void;
  onRefresh?: () => void;
  updateEvents?: () => void;
  readOnly?: boolean;
  isLoading?: boolean;
  onSave?: () => void;
  isSaving?: boolean;
  hasUnsavedChanges?: boolean;
}

interface HistoryState {
  nodes: Node[];
  edges: Edge[];
  timestamp: number;
}

export default function WorkflowCanvas({
  availableEvents = [],
  initialNodes = [],
  initialEdges = [],
  onChange,
  onRefresh: _onRefresh,
  updateEvents,
  readOnly = false,
  isLoading = false,
  onSave,
  isSaving = false,
  hasUnsavedChanges = false,
}: WorkflowCanvasProps) {
  const t = useTranslations("Workflows");
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter events based on search query
  const filteredEvents = availableEvents.filter(
    (event) =>
      event.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (event.description?.toLowerCase().includes(searchQuery.toLowerCase()) ??
        false) ||
      (event.tags?.some((tag: string) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase()),
      ) ??
        false),
  );

  // Track if we're in initial loading phase
  const [isInitializing, setIsInitializing] = useState(true);

  // History management for undo functionality
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1);
  const [lastSavedState, setLastSavedState] = useState<HistoryState | null>(
    null,
  );
  const [historyInitialized, setHistoryInitialized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const maxHistorySize = 50; // Limit history to prevent memory issues

  // Create history state
  const createHistoryState = useCallback(
    (nodes: Node[], edges: Edge[]): HistoryState => {
      return {
        nodes: JSON.parse(JSON.stringify(nodes)) as Node[], // Deep copy
        edges: JSON.parse(JSON.stringify(edges)) as Edge[], // Deep copy
        timestamp: Date.now(),
      };
    },
    [],
  );

  // Add state to history - simplified and reliable
  const addToHistory = useCallback(
    (nodes: Node[], edges: Edge[]) => {
      if (isInitializing) {
        return;
      }

      const newState = createHistoryState(nodes, edges);

      setHistory((prevHistory) => {
        // Remove any future history if we're not at the end
        const truncatedHistory = prevHistory.slice(0, currentHistoryIndex + 1);
        const newHistory = [...truncatedHistory, newState];

        // Limit history size
        const limitedHistory =
          newHistory.length > maxHistorySize
            ? newHistory.slice(-maxHistorySize)
            : newHistory;

        return limitedHistory;
      });

      // Update the index separately
      setCurrentHistoryIndex((prev) => {
        const newIndex = Math.min(prev + 1, maxHistorySize - 1);
        return newIndex;
      });
    },
    [isInitializing, createHistoryState, currentHistoryIndex, maxHistorySize],
  );

  // Track if initial data has been loaded
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [prevNodesLength, setPrevNodesLength] = useState(0);

  // Load initial data only once
  useEffect(() => {
    // Only set nodes if we have data and haven't loaded yet, or if nodes changed from empty to populated
    if (
      initialNodes.length > 0 &&
      (!initialDataLoaded || prevNodesLength === 0)
    ) {
      setNodes(initialNodes);
      setInitialDataLoaded(true);
      setPrevNodesLength(initialNodes.length);

      // Fit view after nodes are set
      if (reactFlowInstance) {
        setTimeout(() => {
          void reactFlowInstance.fitView({ padding: 0.2, duration: 200 });
        }, 100);
      }
    }

    // Reset initialization flag after a short delay to allow for initial rendering
    const timer = setTimeout(() => {
      setIsInitializing(false);
      // Initialize history only once after nodes and edges are set
      if (
        !historyInitialized &&
        (initialNodes.length > 0 || initialEdges.length > 0)
      ) {
        const initialState = createHistoryState(initialNodes, initialEdges);
        setHistory([initialState]);
        setCurrentHistoryIndex(0);
        setLastSavedState(initialState);
        setHistoryInitialized(true);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [
    initialNodes,
    initialEdges,
    createHistoryState,
    historyInitialized,
    reactFlowInstance,
    initialDataLoaded,
    prevNodesLength,
    setNodes, // This is stable from the hook
  ]);

  // Track if initial edges have been loaded
  const [initialEdgesLoaded, setInitialEdgesLoaded] = useState(false);

  useEffect(() => {
    // Only set edges if they've actually changed and we have data
    if (initialEdges.length > 0 && !initialEdgesLoaded) {
      // Normalize edges to ensure all required properties are present
      const normalizedEdges = initialEdges.map((edge) => ({
        ...edge,
        type: edge.type ?? "connectionEdge",
        data: edge.data ?? { type: ConnectionType.ALWAYS },
        animated: edge.animated ?? true,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })) as Edge[];
      setEdges(normalizedEdges);
      setInitialEdgesLoaded(true);

      // Fit view again after edges are set if we have nodes
      if (reactFlowInstance && nodes.length > 0) {
        setTimeout(() => {
          void reactFlowInstance.fitView({ padding: 0.2, duration: 200 });
        }, 150);
      }
    }
  }, [
    initialEdges,
    reactFlowInstance,
    nodes.length,
    initialEdgesLoaded,
    setEdges,
  ]);

  // Update last saved state when save is called
  useEffect(() => {
    if (!isSaving && hasUnsavedChanges === false && !isInitializing) {
      // Save was successful, update last saved state
      const currentState = createHistoryState(nodes, edges);
      setLastSavedState(currentState);
    }
  }, [
    isSaving,
    hasUnsavedChanges,
    isInitializing,
    nodes,
    edges,
    createHistoryState,
  ]);

  // Undo functionality
  const canUndo = currentHistoryIndex > 0;
  const canUndoToSave = lastSavedState !== null && history.length > 0;

  const undo = useCallback(() => {
    if (!canUndo || readOnly) {
      return;
    }

    const previousIndex = currentHistoryIndex - 1;
    if (previousIndex >= 0 && history[previousIndex]) {
      const previousState = history[previousIndex];

      setNodes(previousState.nodes);
      // Normalize edges from history
      const normalizedEdges = previousState.edges.map((edge) => ({
        ...edge,
        type: edge.type ?? "connectionEdge",
        data: edge.data ?? { type: ConnectionType.ALWAYS },
        animated: edge.animated ?? true,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })) as Edge[];
      setEdges(normalizedEdges);
      setCurrentHistoryIndex(previousIndex);

      // Notify parent of changes
      if (onChange && !isInitializing) {
        onChange(previousState.nodes, previousState.edges);
      }
    }
  }, [
    canUndo,
    readOnly,
    currentHistoryIndex,
    history,
    setNodes,
    setEdges,
    onChange,
    isInitializing,
  ]);

  const undoAllChanges = useCallback(() => {
    if (!canUndoToSave || !lastSavedState || readOnly) {
      return;
    }

    setNodes(lastSavedState.nodes);
    // Normalize edges from saved state
    const normalizedEdges = lastSavedState.edges.map((edge) => ({
      ...edge,
      type: edge.type ?? "connectionEdge",
      data: edge.data ?? { type: ConnectionType.ALWAYS },
      animated: edge.animated ?? true,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
    })) as Edge[];
    setEdges(normalizedEdges);

    // Reset history to last saved state
    setHistory([lastSavedState]);
    setCurrentHistoryIndex(0);

    // Notify parent of changes
    if (onChange && !isInitializing) {
      onChange(lastSavedState.nodes, lastSavedState.edges);
    }
  }, [
    canUndoToSave,
    lastSavedState,
    readOnly,
    setNodes,
    setEdges,
    onChange,
    isInitializing,
  ]);

  // Call onChange only for user interactions, not prop updates
  const notifyParentOfChanges = useCallback(
    (newNodes: Node[], newEdges: Edge[]) => {
      if (onChange && !isInitializing) {
        onChange(newNodes, newEdges);
      }
    },
    [onChange, isInitializing],
  );

  // Handle node changes
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // If in readOnly mode, only allow selection changes
      if (readOnly) {
        const allowedChanges = changes.filter(
          (change) => change.type === "select",
        );
        if (allowedChanges.length > 0) {
          onNodesChange(allowedChanges);
        }
        return;
      }

      const updatedNodes = applyNodeChanges(changes, nodes);
      setNodes(updatedNodes);

      // Handle drag operations specially
      const dragStart = changes.find(
        (change) => change.type === "position" && change.dragging === true,
      );
      const dragEnd = changes.find(
        (change) => change.type === "position" && change.dragging === false,
      );

      if (dragStart && !isDragging) {
        // Start of drag - capture initial state
        setIsDragging(true);
      } else if (dragEnd && isDragging) {
        // End of drag - add to history only now
        setIsDragging(false);
        addToHistory(updatedNodes, edges);
      } else {
        // Handle non-drag changes (add, remove, etc.)
        const hasMeaningfulChange = changes.some(
          (change) =>
            change.type !== "select" &&
            change.type !== "dimensions" &&
            change.type !== "position", // Don't track position changes during drag
        );
        if (hasMeaningfulChange) {
          addToHistory(updatedNodes, edges);
        }
      }

      // Parent will be notified via useEffect

      // Keep track of selected node
      const selectedNodes = updatedNodes.filter((node) => node.selected);
      setSelectedNode(
        selectedNodes.length > 0 && selectedNodes[0] ? selectedNodes[0] : null,
      );
    },
    [
      nodes,
      edges,
      onNodesChange,
      readOnly,
      setNodes,
      notifyParentOfChanges,
      addToHistory,
      isDragging,
      createHistoryState,
    ],
  );

  // Store nodes in a ref so we always have the current value
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  // Track when edges are updated by ConnectionEdge component
  const lastNotifiedEdgesRef = useRef<string>("");

  useEffect(() => {
    // Only check for changes after initialization
    if (!isInitializing) {
      const currentEdgesStr = JSON.stringify(
        edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          data: e.data,
        })),
      );

      // Only notify if the edges have actually changed since last notification
      if (lastNotifiedEdgesRef.current !== currentEdgesStr) {
        lastNotifiedEdgesRef.current = currentEdgesStr;
        // Use the current nodes from ref and notify parent
        if (onChange) {
          onChange(nodesRef.current, edges);
        }
      }
    }
  }, [edges, isInitializing, onChange]); // Safe dependencies

  // Handle edge changes
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;

      // Apply the changes via the onEdgesChange handler from useEdgesState
      onEdgesChange(changes);

      // Track meaningful changes in history (not selection changes)
      const hasMeaningfulChange = changes.some(
        (change) => change.type !== "select",
      );
      if (hasMeaningfulChange) {
        addToHistory(nodes, edges);
        // Parent notification will happen via useEffect
      }
    },
    [readOnly, onEdgesChange, addToHistory, nodes, edges],
  );

  // Handle connections between nodes
  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;

      // Validate the new connection before adding it
      const validation = validateWorkflowStructure(nodes, edges, connection);
      if (!validation.isValid) {
        toast({
          title: "Invalid Workflow Connection",
          description: validation.error,
          variant: "destructive",
        });
        return;
      }

      // Create edge with appropriate type and ensure all required properties are defined
      const newEdge = {
        ...connection,
        id: `e-${connection.source}-${connection.target}`,
        type: "connectionEdge", // Ensure type is always defined as a string
        data: { type: ConnectionType.ALWAYS },
        animated: true,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      };

      // Add the edge and ensure all edges have required properties
      // Normalize existing edges to match addEdge's expected type
      const normalizedExistingEdges = edges.map((edge) => ({
        ...edge,
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type ?? "connectionEdge",
        data: edge.data
          ? {
              ...edge.data,
              connectionType:
                (edge.data?.connectionType as ConnectionType) ??
                ConnectionType.ALWAYS,
            }
          : { connectionType: ConnectionType.ALWAYS },
        animated: edge.animated ?? true,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      }));

      const edgesWithNewEdge = addEdge(newEdge, normalizedExistingEdges);
      const updatedEdges = edgesWithNewEdge.map((edge) => ({
        ...edge,
        type: edge.type ?? "connectionEdge",
        data: edge.data ?? { type: ConnectionType.ALWAYS },
        animated: edge.animated ?? true,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      })) as Edge[];
      setEdges(updatedEdges);

      // Track connection in history
      addToHistory(nodes, updatedEdges);

      // Parent will be notified via useEffect
    },
    [edges, nodes, setEdges, readOnly, notifyParentOfChanges, addToHistory],
  );

  // Handle dropping a new node onto the canvas
  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (readOnly) return;

      event.preventDefault();

      const eventIdString = event.dataTransfer.getData(
        "application/reactflow/event",
      );
      if (!eventIdString) return;

      try {
        const eventId = parseInt(eventIdString);
        const eventData = availableEvents.find((event) => event.id === eventId);

        if (!eventData) {
          console.error("Event not found:", eventId);
          return;
        }

        // Calculate drop position relative to the canvas
        const reactFlowBounds =
          reactFlowWrapper.current?.getBoundingClientRect();
        if (!reactFlowBounds || !reactFlowInstance) return;

        // Use the flow instance to convert screen coordinates to flow coordinates
        const position = reactFlowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        // Center the node on cursor (node is ~192px wide, ~60px tall)
        position.x -= 96;
        position.y -= 30;

        // Calculate new node ID
        const nodeId = `event-${eventId}-${Date.now()}`;

        const newNode = {
          id: nodeId,
          type: "eventNode",
          position,
          data: {
            eventId: eventId,
            label: eventData.name,
            type: eventData.type,
            eventTypeIcon: eventData.type,
            description: "",
            tags: [],
          },
        };

        const updatedNodes = nodes.concat(newNode);
        setNodes(updatedNodes);

        // Track node addition in history
        addToHistory(updatedNodes, edges);

        // Parent will be notified via useEffect
      } catch (error) {
        console.error("Error adding node:", error);
        toast({
          title: "Error",
          description: "Failed to add node to canvas.",
          variant: "destructive",
        });
      }
    },
    [
      availableEvents,
      reactFlowInstance,
      nodes,
      edges,
      setNodes,
      readOnly,
      notifyParentOfChanges,
      toast,
    ],
  );

  // Handle drag over (needed for drop to work)
  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  // Handle node drag start
  const onDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    eventId: number,
  ) => {
    event.dataTransfer.setData(
      "application/reactflow/event",
      eventId.toString(),
    );
    event.dataTransfer.effectAllowed = "move";
  };

  // Delete selected node or edge
  const deleteSelected = useCallback(() => {
    if (readOnly) return;

    // Check if any nodes are selected
    const selectedNodes = nodes.filter((node) => node.selected);
    if (selectedNodes.length > 0) {
      const updatedNodes = nodes.filter((node) => !node.selected);
      const updatedEdges = edges.filter(
        (edge) =>
          !selectedNodes.some(
            (node) => edge.source === node.id || edge.target === node.id,
          ),
      );

      setNodes(updatedNodes);
      setEdges(updatedEdges);

      // Track deletion in history
      addToHistory(updatedNodes, updatedEdges);

      setSelectedNode(null);
      return;
    }

    // Check if any edges are selected
    const selectedEdges = edges.filter((edge) => edge.selected);
    if (selectedEdges.length > 0) {
      const updatedEdges = edges.filter((edge) => !edge.selected);
      setEdges(updatedEdges);

      // Track edge deletion in history
      addToHistory(nodes, updatedEdges);
    }
  }, [nodes, edges, setNodes, setEdges, readOnly, addToHistory]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (readOnly) return;

      // Don't handle shortcuts if user is typing in an input, textarea, or contenteditable
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.contentEditable === "true" ||
        target.isContentEditable ||
        target.closest("[role='dialog']") || // Don't handle if inside a modal/dialog
        target.closest("[data-radix-popper-content-wrapper]") || // Don't handle if inside radix popover/dialog
        target.closest(".monaco-editor") || // Don't handle if inside Monaco editor
        target.closest("[data-state='open']") || // Don't handle if inside open popover/dialog
        document.querySelector("[data-state='open']") // Don't handle if any modal/dialog is open
      ) {
        return;
      }

      // Handle Ctrl+Z (Cmd+Z on Mac) for undo
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "z" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        undo();
        return;
      }

      // Handle Delete/Backspace for deletion
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteSelected, readOnly, undo]);

  return (
    <ReactFlowProvider>
      <div
        className="border-border relative h-full overflow-hidden rounded-md border"
        ref={reactFlowWrapper}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={eventNodeType}
          edgeTypes={connectionEdgeType}
          onInit={(instance) => {
            setReactFlowInstance(instance);
            // Ensure nodes are visible after initialization
            setTimeout(() => {
              void instance.fitView({ padding: 0.2, duration: 200 });
            }, 50);
          }}
          fitView={false}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          snapToGrid
          snapGrid={[15, 15]}
          defaultEdgeOptions={{
            type: "connectionEdge",
            animated: true,
          }}
          connectionLineType={ConnectionLineType.Bezier}
          proOptions={{ hideAttribution: true }}
          connectionLineStyle={{ stroke: "#999" }}
          deleteKeyCode="Delete"
        >
          <Background color="#aaa" gap={16} size={1} />
          <Controls
            showInteractive={false}
            className="bg-background border-border fill-foreground border"
          />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            className="border-border bg-background rounded-md border"
          />
          {/* Instructions overlay for empty canvas */}
          {nodes.length === 0 && !readOnly && (
            <div className="bg-pointer-events-none inset-0 z-0 flex h-full items-center justify-center">
              <div className="max-w-md p-6 text-center">
                <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                  <Plus className="text-primary h-6 w-6" />
                </div>
                <h3 className="mb-2 text-lg font-medium">
                  {t("EmptyCanvasTitle")}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {t("EmptyCanvasDescription")}
                </p>
                {availableEvents.length === 0 && (
                  <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-xs">
                    {t("NoEventsHint")}
                  </p>
                )}
              </div>
            </div>
          )}

          {!readOnly && (
            <Panel
              position="top-right"
              className="bg-background/90 border-border z-100 mt-1 mr-1 rounded-lg border p-2 shadow-lg backdrop-blur-sm"
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  {/* Undo Button */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={undo}
                          disabled={!canUndo}
                          className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30"
                        >
                          <Undo className="h-4 w-4" />
                          <span className="sr-only">Undo</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Undo last change (Ctrl+Z)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {/* Undo All Changes Button */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={undoAllChanges}
                          disabled={!canUndoToSave}
                          className="h-8 w-8 p-0 hover:bg-orange-50 hover:text-orange-600 dark:hover:bg-orange-900/30"
                        >
                          <RotateCcw className="h-4 w-4" />
                          <span className="sr-only">Undo all changes</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Undo all changes since last save</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {/* Save Changes Button */}
                  {onSave && (
                    <>
                      {/* Separator */}
                      <div className="bg-border h-6 w-px" />

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              onClick={onSave}
                              disabled={isSaving || !hasUnsavedChanges}
                              size="sm"
                              className="flex h-8 items-center gap-1"
                            >
                              {isSaving ? (
                                <>
                                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                  <span className="text-xs">Saving</span>
                                </>
                              ) : (
                                <>
                                  <CheckCircle className="h-3 w-3" />
                                  <span className="text-xs">Save</span>
                                </>
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Save workflow changes</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      {/* Separator */}
                      <div className="bg-border h-6 w-px" />
                    </>
                  )}

                  {/* Delete Button */}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={deleteSelected}
                          disabled={
                            !selectedNode && edges.every((e) => !e.selected)
                          }
                          className="h-8 w-8 p-0 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Delete selected</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Delete selected (Del)</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>
            </Panel>
          )}

          {!readOnly && (
            <Panel
              position="top-left"
              className={`border-border z-100 mt-1 ml-1 max-h-[calc(100vh-20rem)] rounded-md border transition-all duration-300 ease-in-out ${
                sidebarOpen ? "w-64 overflow-scroll" : "w-8 overflow-hidden"
              }`}
            >
              {/* Events List Sidebar */}
              <div className="z-100 flex h-full flex-col overflow-hidden rounded-md bg-white shadow-md dark:bg-gray-900">
                <div
                  className={`border-border border-b bg-slate-100 text-sm font-medium transition-all duration-300 ease-in-out dark:bg-gray-800 ${
                    sidebarOpen ? "p-3" : "p-2"
                  }`}
                >
                  <div
                    className={`flex items-center ${sidebarOpen ? "justify-between" : "justify-center"}`}
                  >
                    {sidebarOpen && (
                      <h3 className="font-medium">{t("AvailableEvents")}</h3>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:bg-accent/50 h-6 w-6 transition-colors"
                      onClick={() => setSidebarOpen(!sidebarOpen)}
                    >
                      <span className="sr-only">
                        {sidebarOpen ? "Hide events list" : "Show events list"}
                      </span>
                      {sidebarOpen ? (
                        <ChevronLeft className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                {sidebarOpen && (
                  <div className="flex-1 overflow-y-auto p-2 pb-16">
                    {/* Search Bar */}
                    <div className="relative mb-3">
                      <div className="relative">
                        <Search className="text-muted-foreground absolute top-1/2 left-2 h-3 w-3 -translate-y-1/2 transform" />
                        <Input
                          type="text"
                          placeholder="Search events..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="bg-tertiary-bg border-border/40 focus:border-border focus:ring-ring h-7 pr-8 pl-7 text-xs focus:ring-1"
                        />
                        {searchQuery && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="hover:bg-accent/50 absolute top-1/2 right-1 h-5 w-5 -translate-y-1/2 transform p-0"
                            onClick={() => setSearchQuery("")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>

                    {isLoading ? (
                      <div className="text-muted-foreground p-4 text-center text-sm">
                        <Spinner size="md" className="mx-auto mb-2" />
                        <p>Loading events...</p>
                      </div>
                    ) : filteredEvents && filteredEvents.length > 0 ? (
                      <ul className="space-y-1.5 overflow-scroll pb-6">
                        {filteredEvents.map((event) => (
                          <li key={event.id} className="group">
                            <div
                              className="border-border/40 bg-tertiary-bg hover:bg-accent/50 flex cursor-grab items-center justify-between rounded-md border p-2 text-xs font-medium transition-colors"
                              draggable
                              onDragStart={(e) => onDragStart(e, event.id)}
                            >
                              <div className="mr-1.5 flex min-w-0 flex-1 items-center">
                                <div className="mr-2">
                                  <EventTypeIcon type={event.type} size={16} />
                                </div>
                                <span className="max-w-[140px] truncate">
                                  {event.name}
                                </span>
                              </div>
                              <EventDetailsPopover
                                eventId={event.id}
                                eventName={event.name}
                                eventType={event.type}
                                eventDescription={event.description ?? ""}
                                eventTags={event.tags ?? []}
                                {...(event.serverId != null && {
                                  eventServerId: event.serverId,
                                })}
                                {...(event.serverName != null && {
                                  eventServerName: event.serverName,
                                })}
                                {...(event.createdAt != null && {
                                  createdAt: event.createdAt,
                                })}
                                {...(event.updatedAt != null && {
                                  updatedAt: event.updatedAt,
                                })}
                                onEventUpdated={() => {
                                  // Use the same updateEvents function as canvas nodes for consistent refresh
                                  if (updateEvents) {
                                    updateEvents();
                                  }
                                }}
                              >
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 flex-shrink-0 p-0 opacity-70 transition-opacity hover:bg-white/20 hover:opacity-100"
                                  onClick={(e) => e.stopPropagation()}
                                  onDragStart={(e) => e.preventDefault()}
                                  draggable={false}
                                >
                                  <Info className="h-3 w-3" />
                                </Button>
                              </EventDetailsPopover>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : searchQuery &&
                      availableEvents &&
                      availableEvents.length > 0 ? (
                      <div className="text-muted-foreground p-4 text-center text-sm">
                        <Search className="mx-auto mb-2 h-4 w-4" />
                        <p>No events match your search</p>
                        <p className="mt-1 text-xs">Try different keywords</p>
                      </div>
                    ) : (
                      <div className="text-muted-foreground p-4 text-center text-sm">
                        <AlertCircle className="mx-auto mb-2 h-4 w-4" />
                        <p>{t("NoEventsAvailable")}</p>
                        <p className="mt-1 text-xs">{t("CreateEventsFirst")}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}
