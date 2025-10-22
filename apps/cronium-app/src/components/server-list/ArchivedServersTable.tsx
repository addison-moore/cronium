"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { trpc } from "@/lib/trpc";
import { useToast } from "@cronium/ui";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Spinner,
} from "@cronium/ui";
import { Clock, RefreshCw, Trash2, AlertTriangle } from "lucide-react";
import type { Server } from "@/shared/schema";

interface ArchivedServersTableProps {
  servers: Server[];
  lang: string;
}

export function ArchivedServersTable({
  servers: initialServers,
  lang,
}: ArchivedServersTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [servers, setServers] = useState(initialServers);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const restoreServerMutation = trpc.servers.restore.useMutation({
    onSuccess: (data, variables) => {
      toast({
        title: "Server Restored",
        description: data.requiresCredentials
          ? "Server restored. SSH credentials need to be reconfigured."
          : "Server has been successfully restored.",
      });

      // Remove from local state
      setServers((prev) => prev.filter((s) => s.id !== variables.id));

      // If needs reconfiguration, redirect to edit page
      if (data.requiresCredentials) {
        router.push(`/${lang}/dashboard/servers/${variables.id}/edit`);
      }
    },
    onError: (error) => {
      toast({
        title: "Restore Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setRestoringId(null);
    },
  });

  const deleteServerMutation = trpc.servers.permanentDelete.useMutation({
    onSuccess: (_, variables) => {
      toast({
        title: "Server Deleted",
        description: "Server has been permanently deleted.",
      });

      // Remove from local state
      setServers((prev) => prev.filter((s) => s.id !== variables.id));
    },
    onError: (error) => {
      toast({
        title: "Deletion Failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setDeletingId(null);
    },
  });

  const handleRestore = (serverId: number) => {
    setRestoringId(serverId);
    restoreServerMutation.mutate({ id: serverId });
  };

  const handleDelete = (serverId: number) => {
    setDeletingId(serverId);
    deleteServerMutation.mutate({ id: serverId });
  };

  const getDeletionCountdown = (deletionDate: Date | null) => {
    if (!deletionDate) return "Never";

    const now = new Date();
    const deletion = new Date(deletionDate);
    const daysRemaining = Math.ceil(
      (deletion.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysRemaining <= 0) {
      return <Badge variant="destructive">Pending deletion</Badge>;
    } else if (daysRemaining <= 7) {
      return <Badge variant="warning">{daysRemaining} days</Badge>;
    } else {
      return <Badge variant="secondary">{daysRemaining} days</Badge>;
    }
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Archived</TableHead>
            <TableHead>Deletion In</TableHead>
            <TableHead>Reason</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {servers.map((server) => (
            <TableRow key={server.id}>
              <TableCell className="font-medium">{server.name}</TableCell>
              <TableCell>{server.address}</TableCell>
              <TableCell>
                {server.archivedAt
                  ? formatDistanceToNow(new Date(server.archivedAt), {
                      addSuffix: true,
                    })
                  : "Unknown"}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {getDeletionCountdown(server.deletionScheduledAt)}
                </div>
              </TableCell>
              <TableCell>
                {server.archiveReason ?? (
                  <span className="text-muted-foreground">
                    No reason provided
                  </span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestore(server.id)}
                    disabled={restoringId === server.id}
                  >
                    {restoringId === server.id ? (
                      <>
                        <Spinner className="mr-2 h-4 w-4" />
                        Restoring...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Restore
                      </>
                    )}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={deletingId === server.id}
                      >
                        {deletingId === server.id ? (
                          <>
                            <Spinner className="mr-2 h-4 w-4" />
                            Deleting...
                          </>
                        ) : (
                          <>
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete Now
                          </>
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Permanently Delete Server?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          <div className="space-y-4">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="text-destructive mt-0.5 h-5 w-5" />
                              <div>
                                <p className="font-semibold">
                                  This action cannot be undone.
                                </p>
                                <p className="text-sm">
                                  Server "{server.name}" will be permanently
                                  deleted along with all its execution history.
                                </p>
                              </div>
                            </div>

                            {server.sshKeyPurged && server.passwordPurged && (
                              <p className="text-muted-foreground text-sm">
                                Note: SSH credentials have already been purged
                                from this server.
                              </p>
                            )}
                          </div>
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(server.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete Permanently
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
