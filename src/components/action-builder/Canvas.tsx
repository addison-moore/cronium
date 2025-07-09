"use client";

import React, { useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type EdgeTypes,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ActionNode } from "./ActionNode";
import { ActionEdge } from "./ActionEdge";
import { useActionBuilder } from "./useActionBuilder";
import { CANVAS_CONFIG, type NodeType } from "./types";
import { Button } from "@/components/ui/button";
import { Save, Play, RotateCcw, Download, Upload } from "lucide-react";

const nodeTypes: NodeTypes = {
  action: ActionNode,
};

const edgeTypes: EdgeTypes = {
  action: ActionEdge,
};

interface CanvasProps {
  onSave?: (data: { nodes: Node[]; edges: Edge[] }) => void;
  onExecute?: () => void;
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onNodeSelect?: (nodeId: string | null) => void;
  onConnectionSelect?: (connectionId: string | null) => void;
}

function CanvasContent({
  onSave,
  onExecute,
  initialNodes = [],
  initialEdges = [],
  onNodeSelect,
  onConnectionSelect,
}: CanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const {
    nodes,
    edges,
    onNodesChange: _onStoreNodesChange,
    onEdgesChange: _onStoreEdgesChange,
    onConnect: onStoreConnect,
    addNode,
    clearFlow,
  } = useActionBuilder();

  const [flowNodes, setNodes, onNodesChange] = useNodesState(
    initialNodes.length > 0 ? initialNodes : nodes,
  );
  const [flowEdges, setEdges, onEdgesChange] = useEdgesState(
    initialEdges.length > 0 ? initialEdges : edges,
  );

  // Handle node connection
  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      onStoreConnect(params);
      setEdges((eds) => addEdge(params, eds));
    },
    [onStoreConnect, setEdges],
  );

  // Handle drag and drop
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect();
      const type = event.dataTransfer.getData("nodeType") as NodeType;

      if (!type || !reactFlowBounds) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top,
      });

      // Snap to grid
      if (CANVAS_CONFIG.snapToGrid) {
        position.x =
          Math.round(position.x / CANVAS_CONFIG.gridSize) *
          CANVAS_CONFIG.gridSize;
        position.y =
          Math.round(position.y / CANVAS_CONFIG.gridSize) *
          CANVAS_CONFIG.gridSize;
      }

      const nodeData = event.dataTransfer.getData("nodeData");
      const additionalData = nodeData
        ? (JSON.parse(nodeData) as Record<string, unknown>)
        : {};

      addNode(type, position, additionalData);
    },
    [screenToFlowPosition, addNode, setNodes],
  );

  // Handle save
  const handleSave = useCallback(() => {
    if (onSave) {
      onSave({ nodes: flowNodes, edges: flowEdges });
    }
  }, [onSave, flowNodes, flowEdges]);

  // Handle export
  const handleExport = useCallback(() => {
    const data = { nodes: flowNodes, edges: flowEdges };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `action-flow-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [flowNodes, flowEdges]);

  // Handle import
  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (file) {
        const text = await file.text();
        try {
          const data = JSON.parse(text) as { nodes?: Node[]; edges?: Edge[] };
          setNodes(data.nodes ?? []);
          setEdges(data.edges ?? []);
        } catch (error) {
          console.error("Failed to import flow:", error);
        }
      }
    };
    input.click();
  }, [setNodes, setEdges]);

  return (
    <div className="relative h-full w-full" ref={reactFlowWrapper}>
      {/* Toolbar */}
      <div className="bg-background absolute top-4 left-4 z-10 flex gap-2 rounded-lg p-2 shadow-lg">
        <Button size="sm" variant="outline" onClick={handleSave}>
          <Save className="mr-1 h-4 w-4" />
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onExecute}>
          <Play className="mr-1 h-4 w-4" />
          Execute
        </Button>
        <Button size="sm" variant="outline" onClick={clearFlow}>
          <RotateCcw className="mr-1 h-4 w-4" />
          Clear
        </Button>
        <Button size="sm" variant="outline" onClick={handleExport}>
          <Download className="mr-1 h-4 w-4" />
          Export
        </Button>
        <Button size="sm" variant="outline" onClick={handleImport}>
          <Upload className="mr-1 h-4 w-4" />
          Import
        </Button>
      </div>

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        snapToGrid={CANVAS_CONFIG.snapToGrid}
        snapGrid={[CANVAS_CONFIG.gridSize, CANVAS_CONFIG.gridSize]}
        defaultViewport={{ x: 0, y: 0, zoom: CANVAS_CONFIG.defaultZoom }}
        minZoom={CANVAS_CONFIG.minZoom}
        maxZoom={CANVAS_CONFIG.maxZoom}
        fitView
        onNodeClick={(_event, node) => onNodeSelect?.(node.id)}
        onEdgeClick={(_event, edge) => onConnectionSelect?.(edge.id)}
        onPaneClick={() => {
          onNodeSelect?.(null);
          onConnectionSelect?.(null);
        }}
      >
        <Background gap={CANVAS_CONFIG.gridSize} />
        <Controls />
        <MiniMap
          nodeColor={(node) => {
            if (node.data?.isConfigured) {
              return "#10b981"; // green
            }
            return "#ef4444"; // red
          }}
          className="bg-background"
          maskColor="rgb(0, 0, 0, 0.1)"
        />
      </ReactFlow>
    </div>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasContent {...props} />
    </ReactFlowProvider>
  );
}
