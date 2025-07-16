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
import { useTranslations } from "next-intl";
import { toast } from "@/components/ui/use-toast";
import { ConnectionType } from "@/shared/schema";

// Import validation
import { validateWorkflowStructure } from "./validation/workflowValidation";

// Import hooks
import { useWorkflowHistory } from "./hooks/useWorkflowHistory";

// Import components
import { EmptyCanvasPrompt } from "./components/EmptyCanvasPrompt";
import { EventSidebar } from "./components/EventSidebar";
import { WorkflowToolbar } from "./components/WorkflowToolbar";

// Import custom nodes and edges
import EventNode from "./nodes/EventNode";
import ConnectionEdge from "./edges/ConnectionEdge";
import { Spinner } from "../ui/spinner";
import type { EventType } from "@/shared/schema";

// Type definitions
const eventNodeType: NodeTypes = { eventNode: EventNode };
const connectionEdgeType: EdgeTypes = { connectionEdge: ConnectionEdge };

interface AvailableEvent {
  id: number;
  name: string;
  type: EventType;
  description?: string | null;
  tags?: string[] | null;
}

interface WorkflowCanvasProps {
  workflowId: number;
  availableEvents: AvailableEvent[];
  initialNodes: Node[];
  initialEdges: Edge[];
  onSave: (nodes: Node[], edges: Edge[]) => Promise<void>;
  isLoading?: boolean;
}

function WorkflowCanvasInner({
  workflowId,
  availableEvents,
  initialNodes,
  initialEdges,
  onSave,
  isLoading = false,
}: WorkflowCanvasProps) {
  const t = useTranslations("workflows");
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Use the history hook
  const {
    canUndo,
    canUndoToSave,
    hasUnsavedChanges: hasUnsavedChangesFunc,
    addToHistory,
    undo,
    undoAllChanges,
    markAsSaved,
    initializeWithSavedState,
    isUpdatingFromHistory,
  } = useWorkflowHistory({
    maxHistorySize: 50,
  });

  // Initialize with saved state
  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);

    const timer = setTimeout(() => {
      setIsInitializing(false);
      if (initialNodes.length > 0 || initialEdges.length > 0) {
        initializeWithSavedState(initialNodes, initialEdges);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [
    initialNodes,
    initialEdges,
    setNodes,
    setEdges,
    initializeWithSavedState,
  ]);

  // Track unsaved changes
  const hasUnsavedChanges = hasUnsavedChangesFunc(nodes, edges);

  // Handle history updates
  useEffect(() => {
    if (!isInitializing && !isDragging && !isUpdatingFromHistory) {
      addToHistory(nodes, edges);
    }
  }, [
    nodes,
    edges,
    isInitializing,
    isDragging,
    isUpdatingFromHistory,
    addToHistory,
  ]);

  // Handle node changes with validation
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (isUpdatingFromHistory) {
        onNodesChange(changes);
        return;
      }

      const updatedNodes = applyNodeChanges(changes, nodes);
      const validationResult = validateWorkflowStructure(updatedNodes, edges);

      if (!validationResult.isValid) {
        toast({
          title: t("validationError"),
          description: validationResult.error,
          variant: "destructive",
        });
        return;
      }

      onNodesChange(changes);
    },
    [nodes, edges, onNodesChange, isUpdatingFromHistory, t],
  );

  // Handle connection validation
  const onConnect = useCallback(
    (params: Connection) => {
      const validationResult = validateWorkflowStructure(nodes, edges, params);

      if (!validationResult.isValid) {
        toast({
          title: t("connectionError"),
          description: validationResult.error,
          variant: "destructive",
        });
        return;
      }

      setEdges((eds) =>
        addEdge(
          {
            ...params,
            type: "connectionEdge",
            data: { type: ConnectionType.SUCCESS },
          },
          eds,
        ),
      );
    },
    [nodes, edges, setEdges, t],
  );

  // Handle drag and drop
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!reactFlowWrapper.current || !reactFlowInstance) return;

      const eventData = event.dataTransfer.getData("application/reactflow");
      if (!eventData) return;

      const parsedEvent = JSON.parse(eventData) as AvailableEvent;
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.project({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const newNode: Node = {
        id: `${parsedEvent.id}_${Date.now()}`,
        type: "eventNode",
        position,
        data: {
          label: parsedEvent.name,
          eventId: parsedEvent.id,
          eventType: parsedEvent.type,
          description: parsedEvent.description,
        },
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes],
  );

  const onDragStart = useCallback(
    (event: React.DragEvent, eventData: AvailableEvent) => {
      event.dataTransfer.setData(
        "application/reactflow",
        JSON.stringify(eventData),
      );
      event.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  // Handle save
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await onSave(nodes, edges);
      markAsSaved(nodes, edges);
      toast({
        title: t("saveSuccess"),
        description: t("workflowSaved"),
      });
    } catch (error) {
      toast({
        title: t("saveError"),
        description: error instanceof Error ? error.message : t("unknownError"),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [nodes, edges, onSave, markAsSaved, t]);

  // Handle undo
  const handleUndo = useCallback(() => {
    const previousState = undo();
    if (previousState) {
      setNodes(previousState.nodes);
      setEdges(previousState.edges);
    }
  }, [undo, setNodes, setEdges]);

  // Handle undo all
  const handleUndoAllChanges = useCallback(() => {
    const savedState = undoAllChanges();
    if (savedState) {
      setNodes(savedState.nodes);
      setEdges(savedState.edges);
    }
  }, [undoAllChanges, setNodes, setEdges]);

  // Handle delete selected
  const deleteSelected = useCallback(() => {
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

    setNodes((nds) => nds.filter((node) => !selectedNodes.includes(node.id)));
    setEdges((eds) => eds.filter((edge) => !selectedEdges.includes(edge.id)));

    setSelectedNodes([]);
    setSelectedEdges([]);

    toast({
      title: t("itemsDeleted"),
      description: t("selectedItemsDeleted"),
    });
  }, [selectedNodes, selectedEdges, setNodes, setEdges, t]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (
        e.key === "Delete" &&
        (selectedNodes.length > 0 || selectedEdges.length > 0)
      ) {
        deleteSelected();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasUnsavedChanges) {
          void handleSave();
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [
    deleteSelected,
    handleUndo,
    handleSave,
    hasUnsavedChanges,
    selectedNodes,
    selectedEdges,
  ]);

  // Handle selection change
  const onSelectionChange = useCallback(
    ({
      nodes: selectedNodesList,
      edges: selectedEdgesList,
    }: {
      nodes: Node[];
      edges: Edge[];
    }) => {
      setSelectedNodes(selectedNodesList.map((n) => n.id));
      setSelectedEdges(selectedEdgesList.map((e) => e.id));
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  const hasSelection = selectedNodes.length > 0 || selectedEdges.length > 0;

  return (
    <div className="relative h-full w-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onSelectionChange={onSelectionChange}
        nodeTypes={eventNodeType}
        edgeTypes={connectionEdgeType}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        snapToGrid
        snapGrid={[15, 15]}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: "#94a3b8", strokeWidth: 2 },
        }}
      >
        <Background variant="dots" gap={20} size={1} />
        <Controls />
        <MiniMap />

        {/* Empty Canvas Prompt */}
        {nodes.length === 0 && !isDragging && (
          <EmptyCanvasPrompt hasNoEvents={availableEvents.length === 0} />
        )}

        {/* Workflow Toolbar */}
        <Panel position="top-left">
          <WorkflowToolbar
            canUndo={canUndo}
            canUndoToSave={canUndoToSave}
            onUndo={handleUndo}
            onUndoAllChanges={handleUndoAllChanges}
            onSave={handleSave}
            isSaving={isSaving}
            hasUnsavedChanges={hasUnsavedChanges}
            onDelete={deleteSelected}
            hasSelection={hasSelection}
          />
        </Panel>

        {/* Event Sidebar */}
        <EventSidebar
          availableEvents={availableEvents}
          isLoading={false}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          onDragStart={onDragStart}
          updateEvents={() => {
            // Refresh events if needed
          }}
        />
      </ReactFlow>
    </div>
  );
}

export default function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
