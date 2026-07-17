"use client";

import { useState } from "react";
import { Plus, Edit, Trash2, Boxes } from "lucide-react";
import { Button } from "@cronium/ui";
import { Card, CardContent } from "@cronium/ui";
import { useToast } from "@cronium/ui";
import { ConfirmationDialog } from "@cronium/ui";
import {
  StandardizedTable,
  type StandardizedTableColumn,
  type StandardizedTableAction,
} from "@cronium/ui";
import { ServerGroupModal, type ServerGroupData } from "./ServerGroupModal";
import { formatDate } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { QUERY_OPTIONS } from "@/trpc/shared";

const copy = {
  addGroup: "Add Group",
  name: "Name",
  servers: "Servers",
  created: "Created",
  editGroup: "Edit Group",
  deleteGroup: "Delete Group",
  noGroups: "No Server Groups",
  noGroupsMessage: "Create a group to organize your servers.",
  deleteTitle: "Delete Group",
  deleteDescription:
    "Are you sure you want to delete this group? The servers in it are not affected.",
} as const;

export default function ServerGroupsTab() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ServerGroupData | null>(
    null,
  );
  const [deleteGroupId, setDeleteGroupId] = useState<number | null>(null);
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: groupsData, isLoading } = trpc.servers.getGroups.useQuery(
    undefined,
    QUERY_OPTIONS.dynamic,
  );

  const { data: serversData } = trpc.servers.getAll.useQuery(
    { limit: 100, offset: 0 },
    QUERY_OPTIONS.dynamic,
  );

  const groups: ServerGroupData[] = groupsData?.groups ?? [];
  const servers = (serversData?.servers ?? []).map((server) => ({
    id: server.id,
    name: server.name,
    address: server.address,
  }));

  const deleteGroupMutation = trpc.servers.deleteGroup.useMutation({
    onSuccess: () => {
      toast({ title: "Success", description: "Group deleted successfully" });
      void utils.servers.getGroups.invalidate();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete group",
        variant: "destructive",
      });
    },
  });

  const openCreateModal = () => {
    setEditingGroup(null);
    setIsModalOpen(true);
  };

  const openEditModal = (group: ServerGroupData) => {
    setEditingGroup(group);
    setIsModalOpen(true);
  };

  const serverNames = (serverIds: number[]): string => {
    if (serverIds.length === 0) return "—";
    return serverIds
      .map(
        (id) =>
          servers.find((server) => server.id === id)?.name ?? `Server ${id}`,
      )
      .join(", ");
  };

  const columns: StandardizedTableColumn<ServerGroupData>[] = [
    {
      key: "name",
      header: copy.name,
      cell: (group) => (
        <button
          type="button"
          onClick={() => openEditModal(group)}
          className="text-primary cursor-pointer font-medium hover:underline"
        >
          {group.name}
        </button>
      ),
    },
    {
      key: "servers",
      header: copy.servers,
      cell: (group) => (
        <span className="text-muted-foreground block max-w-md truncate text-sm">
          {serverNames(group.serverIds)}
        </span>
      ),
    },
    {
      key: "created",
      header: copy.created,
      cell: (group) => formatDate(group.createdAt),
    },
  ];

  const getGroupActions = (
    group: ServerGroupData,
  ): StandardizedTableAction[] => [
    {
      label: copy.editGroup,
      icon: <Edit className="h-4 w-4" />,
      onClick: () => openEditModal(group),
    },
    {
      label: copy.deleteGroup,
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => setDeleteGroupId(group.id),
      variant: "destructive",
      separator: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" />
          {copy.addGroup}
        </Button>
      </div>

      {!isLoading && groups.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center p-8">
              <Boxes className="mb-4 h-16 w-16 text-gray-300" />
              <h2 className="mb-2 text-xl font-semibold">{copy.noGroups}</h2>
              <p className="mb-4 text-center text-gray-500">
                {copy.noGroupsMessage}
              </p>
              <Button onClick={openCreateModal}>
                <Plus className="mr-2 h-4 w-4" />
                {copy.addGroup}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="border-border bg-secondary-bg rounded-lg border p-4">
          <StandardizedTable
            data={groups}
            columns={columns}
            actions={getGroupActions}
            isLoading={isLoading}
            emptyMessage={copy.noGroups}
          />
        </div>
      )}

      <ServerGroupModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        group={editingGroup}
        servers={servers}
      />

      <ConfirmationDialog
        open={deleteGroupId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteGroupId(null);
        }}
        onConfirm={() => {
          if (deleteGroupId !== null) {
            deleteGroupMutation.mutate({ id: deleteGroupId });
          }
          setDeleteGroupId(null);
        }}
        title={copy.deleteTitle}
        description={copy.deleteDescription}
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
      />
    </div>
  );
}
