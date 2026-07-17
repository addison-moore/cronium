"use client";

import type { ReactNode } from "react";
import { Server, Boxes } from "lucide-react";
import { Tabs, TabsContent, TabsList, Tab } from "@cronium/ui";
import { useHashTabNavigation } from "@/hooks/useHashTabNavigation";
import ServerGroupsTab from "./ServerGroupsTab";

interface ServersPageTabsProps {
  /** Server-rendered content for the Servers tab */
  serversTab: ReactNode;
}

export function ServersPageTabs({ serversTab }: ServersPageTabsProps) {
  const { activeTab, changeTab } = useHashTabNavigation({
    defaultTab: "servers",
    validTabs: ["servers", "groups"],
  });

  return (
    <Tabs value={activeTab} onValueChange={changeTab} className="space-y-4">
      <TabsList>
        <Tab value="servers" label="Servers" className="py-2" icon={Server} />
        <Tab value="groups" label="Groups" className="py-2" icon={Boxes} />
      </TabsList>

      <TabsContent value="servers" className="space-y-4">
        {serversTab}
      </TabsContent>

      <TabsContent value="groups" className="space-y-4">
        <ServerGroupsTab />
      </TabsContent>
    </Tabs>
  );
}
