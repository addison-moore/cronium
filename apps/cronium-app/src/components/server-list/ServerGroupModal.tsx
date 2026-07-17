"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@cronium/ui";
import { Button } from "@cronium/ui";
import { Input } from "@cronium/ui";
import { Label } from "@cronium/ui";
import { Checkbox } from "@cronium/ui";
import { useToast } from "@cronium/ui";
import { trpc } from "@/lib/trpc";

export interface ServerGroupData {
  id: number;
  name: string;
  serverIds: number[];
  createdAt: Date | string;
}

interface ServerOption {
  id: number;
  name: string;
  address: string;
}

interface ServerGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Group to edit, or null to create a new one */
  group: ServerGroupData | null;
  servers: ServerOption[];
}

const copy = {
  createTitle: "Add Group",
  editTitle: "Edit Group",
  description: "Name the group and select the servers that belong to it.",
  nameLabel: "Group Name",
  namePlaceholder: "e.g. Proxmox",
  serversLabel: "Servers",
  noServers: "No servers available.",
  cancel: "Cancel",
  create: "Create Group",
  save: "Save Changes",
} as const;

export function ServerGroupModal({
  isOpen,
  onClose,
  group,
  servers,
}: ServerGroupModalProps) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const isEditing = group !== null;

  // Reset form state each time the modal opens
  useEffect(() => {
    if (isOpen) {
      setName(group?.name ?? "");
      setSelectedIds(new Set(group?.serverIds ?? []));
    }
  }, [isOpen, group]);

  const onMutationSuccess = () => {
    toast({
      title: "Success",
      description: isEditing ? "Group updated" : "Group created",
    });
    void utils.servers.getGroups.invalidate();
    onClose();
  };

  const onMutationError = (error: { message?: string }) => {
    toast({
      title: "Error",
      description:
        error.message ??
        (isEditing ? "Failed to update group" : "Failed to create group"),
      variant: "destructive",
    });
  };

  const createGroupMutation = trpc.servers.createGroup.useMutation({
    onSuccess: onMutationSuccess,
    onError: onMutationError,
  });

  const updateGroupMutation = trpc.servers.updateGroup.useMutation({
    onSuccess: onMutationSuccess,
    onError: onMutationError,
  });

  const isSaving =
    createGroupMutation.isPending || updateGroupMutation.isPending;

  const toggleServer = (serverId: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(serverId);
      } else {
        next.delete(serverId);
      }
      return next;
    });
  };

  const handleSave = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast({
        title: "Error",
        description: "Group name is required",
        variant: "destructive",
      });
      return;
    }

    const serverIds = Array.from(selectedIds);
    if (isEditing) {
      updateGroupMutation.mutate({
        id: group.id,
        name: trimmedName,
        serverIds,
      });
    } else {
      createGroupMutation.mutate({ name: trimmedName, serverIds });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? copy.editTitle : copy.createTitle}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">{copy.nameLabel}</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={copy.namePlaceholder}
            />
          </div>

          <div className="space-y-2">
            <Label>{copy.serversLabel}</Label>
            {servers.length === 0 ? (
              <p className="text-muted-foreground text-sm">{copy.noServers}</p>
            ) : (
              <div className="border-border max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
                {servers.map((server) => (
                  <label
                    key={server.id}
                    className="hover:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-md p-2"
                  >
                    <Checkbox
                      checked={selectedIds.has(server.id)}
                      onCheckedChange={(checked) =>
                        toggleServer(server.id, checked === true)
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {server.name}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {server.address}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            {copy.cancel}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isEditing ? copy.save : copy.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
