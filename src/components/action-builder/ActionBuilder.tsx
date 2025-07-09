"use client";

import React from "react";
import { Panel, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Save,
  Download,
  Upload,
  Trash2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { Canvas } from "./Canvas";
import { NodeLibrary } from "./NodeLibrary";
import { ConnectionManager } from "./ConnectionManager";
import { DataMapper } from "./DataMapper";
import { PreviewPanel } from "./PreviewPanel";
import { useActionBuilder } from "./useActionBuilder";
import { type NodeType, type ActionNode, type ActionConnection } from "./types";

interface ActionBuilderProps {
  initialFlow?: {
    nodes: ActionNode[];
    edges: ActionConnection[];
  };
  onSave?: (flow: { nodes: ActionNode[]; edges: ActionConnection[] }) => void;
}

export function ActionBuilder({ initialFlow, onSave }: ActionBuilderProps) {
  const [selectedNode, setSelectedNode] = React.useState<string | null>(null);
  const [selectedConnection, setSelectedConnection] = React.useState<
    string | null
  >(null);
  const [showDataMapper, setShowDataMapper] = React.useState(false);

  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    addNode,
    validateFlow,
    clearFlow,
    getNodeById,
    getConnectionById,
  } = useActionBuilder();

  // Initialize with provided flow
  React.useEffect(() => {
    if (initialFlow) {
      setNodes(initialFlow.nodes);
      setEdges(initialFlow.edges);
    }
  }, [initialFlow, setNodes, setEdges]);

  const _handleNodeSelect = (nodeType: NodeType, data?: unknown) => {
    const position = {
      x: Math.random() * 400 + 100,
      y: Math.random() * 400 + 100,
    };
    addNode(nodeType, position, data);
  };

  const handleSave = () => {
    const validation = validateFlow();
    if (!validation.isValid) {
      // Show validation errors
      console.error("Validation errors:", validation.errors);
      return;
    }
    onSave?.({ nodes, edges });
  };

  const handleExport = () => {
    const flow = { nodes, edges };
    const blob = new Blob([JSON.stringify(flow, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "action-flow.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const flow = JSON.parse(text) as {
          nodes?: ActionNode[];
          edges?: ActionConnection[];
        };
        setNodes(flow.nodes ?? []);
        setEdges(flow.edges ?? []);
      } catch (error) {
        console.error("Failed to import flow:", error);
      }
    };
    input.click();
  };

  const validation = React.useMemo(() => validateFlow(), [nodes, edges]);

  const selectedNodeData = React.useMemo(() => {
    if (!selectedNode) return null;
    return getNodeById(selectedNode);
  }, [selectedNode, getNodeById, nodes]);

  const _selectedConnectionData = React.useMemo(() => {
    if (!selectedConnection) return null;
    return getConnectionById(selectedConnection);
  }, [selectedConnection, getConnectionById, edges]);

  return (
    <ReactFlowProvider>
      <div className="flex h-screen">
        {/* Left Panel - Node Library */}
        <div className="bg-background border-r">
          <NodeLibrary />
        </div>

        {/* Center - Canvas */}
        <div className="flex-1">
          <Canvas
            onNodeSelect={setSelectedNode}
            onConnectionSelect={setSelectedConnection}
          />
          <Panel position="top-left" className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleSave}>
              <Save className="mr-1 h-4 w-4" />
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={handleExport}>
              <Download className="mr-1 h-4 w-4" />
              Export
            </Button>
            <Button size="sm" variant="outline" onClick={handleImport}>
              <Upload className="mr-1 h-4 w-4" />
              Import
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={clearFlow}
              className="text-destructive"
            >
              <Trash2 className="mr-1 h-4 w-4" />
              Clear
            </Button>
          </Panel>
          <Panel position="top-right" className="flex items-center gap-2">
            {validation.isValid ? (
              <Badge variant="default" className="gap-1">
                <CheckCircle className="h-3 w-3" />
                Valid Flow
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <AlertCircle className="h-3 w-3" />
                {validation.errors.length} Issues
              </Badge>
            )}
          </Panel>
        </div>

        {/* Right Panel - Configuration */}
        <div className="bg-background w-96 border-l">
          <Tabs defaultValue="node" className="h-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="node">Node</TabsTrigger>
              <TabsTrigger value="connection">Connection</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="node" className="mt-0 h-full p-4">
              {selectedNodeData ? (
                <Card>
                  <div className="p-4">
                    <h3 className="mb-2 font-semibold">
                      {selectedNodeData.data.label}
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      Configure node settings here...
                    </p>
                    {selectedNodeData.data.toolId && (
                      <div className="mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowDataMapper(true)}
                        >
                          Configure Data Mapping
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ) : (
                <div className="text-muted-foreground py-8 text-center text-sm">
                  Select a node to configure
                </div>
              )}

              {showDataMapper && selectedNodeData && (
                <div className="mt-4">
                  <DataMapper
                    sourceName="Previous Node"
                    targetName={selectedNodeData.data.label}
                    mappings={[]}
                    onMappingsChange={(mappings) => {
                      console.log("Mappings changed:", mappings);
                    }}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="connection" className="mt-0 h-full p-4">
              {selectedConnection ? (
                <ConnectionManager selectedConnection={selectedConnection} />
              ) : (
                <div className="text-muted-foreground py-8 text-center text-sm">
                  Select a connection to configure
                </div>
              )}
            </TabsContent>

            <TabsContent value="preview" className="mt-0 h-full">
              <PreviewPanel />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </ReactFlowProvider>
  );
}
