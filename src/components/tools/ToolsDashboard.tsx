"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Activity,
  Search,
  Zap,
  BarChart3,
  Clock,
  AlertCircle,
  CheckCircle,
  Settings,
  Plus,
  Play,
} from "lucide-react";
import Link from "next/link";
import { ToolPluginRegistry } from "@/components/tools/plugins";
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { formatDistanceToNow } from "date-fns";
import { ModularToolsManager } from "@/components/tools/modular-tools-manager";
import { usePathname } from "next/navigation";

// Tool action browser component
function ActionBrowser({ locale }: { locale: string }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const allPlugins = ToolPluginRegistry.getAll();

  // Get all actions with their tools
  const allActions = useMemo(() => {
    const actions: Array<{
      action: any;
      tool: any;
      category: string;
    }> = [];

    allPlugins.forEach((plugin) => {
      if (plugin.actions) {
        plugin.actions.forEach((action) => {
          actions.push({
            action,
            tool: plugin,
            category: plugin.category || "Other",
          });
        });
      }
    });

    return actions;
  }, [allPlugins]);

  // Filter actions based on search and category
  const filteredActions = useMemo(() => {
    return allActions.filter(({ action, tool, category }) => {
      const matchesSearch =
        !searchQuery ||
        action.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        action.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tool.name.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCategory =
        !selectedCategory || category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [allActions, searchQuery, selectedCategory]);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(allActions.map((a) => a.category));
    return Array.from(cats).sort();
  }, [allActions]);

  return (
    <div className="space-y-4">
      {/* Search and filters */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search actions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant={!selectedCategory ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedCategory(null)}
          >
            All
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={selectedCategory === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Actions grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredActions.map(({ action, tool }) => {
          const Icon = tool.icon;
          return (
            <Card
              key={`${tool.id}-${action.id}`}
              className="transition-shadow hover:shadow-md"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="text-primary h-5 w-5" />
                    <div>
                      <CardTitle className="text-base">{action.name}</CardTitle>
                      <p className="text-muted-foreground text-xs">
                        {tool.name}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">{action.actionType}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-3 text-sm">
                  {action.description}
                </p>
                <div className="flex items-center justify-between">
                  <Link
                    href={`/${locale}/dashboard/events/new?type=TOOL_ACTION&toolType=${tool.id}&actionId=${action.id}`}
                  >
                    <Button size="sm" variant="outline">
                      <Plus className="mr-1 h-3 w-3" />
                      Create Event
                    </Button>
                  </Link>
                  <Button size="sm" variant="ghost">
                    <Play className="mr-1 h-3 w-3" />
                    Test
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// Execution history component
function ExecutionHistory() {
  const { data: logsData, isLoading } = trpc.toolActionLogs.getRecent.useQuery({
    limit: 50,
  });

  const logs = logsData?.logs ?? [];

  if (isLoading) {
    return <div className="py-8 text-center">Loading execution history...</div>;
  }

  if (logs.length === 0) {
    return (
      <div className="py-12 text-center">
        <Activity className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
        <h3 className="text-lg font-medium">No executions yet</h3>
        <p className="text-muted-foreground">
          Tool actions will appear here when executed
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map((log) => (
        <Card key={log.id}>
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {log.status === "SUCCESS" ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-500" />
                )}
                <div>
                  <p className="font-medium">{log.actionId}</p>
                  <p className="text-muted-foreground text-sm">
                    {log.toolType} •{" "}
                    {formatDistanceToNow(new Date(log.createdAt))} ago
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={log.status === "SUCCESS" ? "default" : "destructive"}
                >
                  {log.status}
                </Badge>
                <span className="text-muted-foreground text-sm">
                  {log.executionTime}ms
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Health overview component
function HealthOverview() {
  const { data: statsData } = trpc.tools.getStats.useQuery({
    period: "day",
    groupBy: "type",
  });

  const { data: toolsData } = trpc.tools.getAll.useQuery({
    limit: 100,
  });

  const tools = toolsData?.tools ?? [];
  const activeTools = tools.filter((t) => t.isActive);

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tools.length}</div>
            <p className="text-muted-foreground text-xs">
              {activeTools.length} active
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {ToolPluginRegistry.getAll().reduce(
                (acc, p) => acc + (p.actions?.length || 0),
                0,
              )}
            </div>
            <p className="text-muted-foreground text-xs">Across all tools</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Executions Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsData?.executionsToday ?? 0}
            </div>
            <p className="text-muted-foreground text-xs">
              {statsData?.successRate ?? 0}% success rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Avg Response Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statsData?.avgResponseTime ?? 0}ms
            </div>
            <p className="text-muted-foreground text-xs">Last 24 hours</p>
          </CardContent>
        </Card>
      </div>

      {/* Tools health grid */}
      <Card>
        <CardHeader>
          <CardTitle>Tool Health Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tools.map((tool) => {
              const plugin = ToolPluginRegistry.get(tool.type.toLowerCase());
              if (!plugin) return null;

              const Icon = plugin.icon;
              return (
                <div
                  key={tool.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="text-primary h-5 w-5" />
                    <div>
                      <p className="font-medium">{tool.name}</p>
                      <p className="text-muted-foreground text-xs">
                        {plugin.name}
                      </p>
                    </div>
                  </div>
                  <Badge variant={tool.isActive ? "default" : "secondary"}>
                    {tool.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ToolsDashboard({ dict }: { dict: any }) {
  const [activeTab, setActiveTab] = useState("management");
  const pathname = usePathname();
  const locale = pathname.split("/")[1] ?? "";

  return (
    <div className="space-y-6">
      {/* Main content tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="management">
            <Settings className="mr-2 h-4 w-4" />
            Management
          </TabsTrigger>
          <TabsTrigger value="browse">
            <Zap className="mr-2 h-4 w-4" />
            Browse Actions
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="mr-2 h-4 w-4" />
            Execution History
          </TabsTrigger>
          <TabsTrigger value="health">
            <BarChart3 className="mr-2 h-4 w-4" />
            Health Overview
          </TabsTrigger>
        </TabsList>

        <TabsContent value="management" className="space-y-4">
          <ModularToolsManager />
        </TabsContent>

        <TabsContent value="browse" className="space-y-4">
          <ActionBrowser locale={locale} />
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <ExecutionHistory />
        </TabsContent>

        <TabsContent value="health" className="space-y-4">
          <HealthOverview />
        </TabsContent>
      </Tabs>
    </div>
  );
}
