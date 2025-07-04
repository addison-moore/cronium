"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Loader2,
  Copy,
  Check,
  Plus,
  Trash,
  AlertTriangle,
  Calendar,
  Clock,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { trpc } from "@/lib/trpc";

type ApiToken = {
  id: number;
  name: string;
  status: "ACTIVE" | "REVOKED";
  createdAt: string;
  lastUsed?: string | null;
  expiresAt?: string | null;
  displayToken?: string; // Only present when a token is first created
};

const createTokenSchema = z.object({
  name: z.string().min(1, "Token name is required").max(100, "Token name is too long"),
});

type CreateTokenFormData = z.infer<typeof createTokenSchema>;

export default function ApiTokensManager() {
  const [showNewTokenDialog, setShowNewTokenDialog] = useState<boolean>(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const form = useForm<CreateTokenFormData>({
    resolver: zodResolver(createTokenSchema),
    defaultValues: {
      name: "",
    },
  });

  // tRPC queries and mutations
  const {
    data: tokens,
    isLoading,
    error,
    refetch,
  } = trpc.auth.getApiTokens.useQuery();

  const createTokenMutation = trpc.auth.createApiToken.useMutation({
    onSuccess: (data) => {
      refetch();
      setNewToken(data.displayToken);
      form.reset();
      setShowNewTokenDialog(true);
      toast({
        title: "Token created",
        description: "Your new API token has been created successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to create token",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const revokeTokenMutation = trpc.auth.revokeApiToken.useMutation({
    onSuccess: () => {
      refetch();
      toast({
        title: "Token revoked",
        description:
          "The API token has been revoked and can no longer be used.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to revoke token",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteTokenMutation = trpc.auth.deleteApiToken.useMutation({
    onSuccess: () => {
      refetch();
      toast({
        title: "Token deleted",
        description: "The API token has been permanently deleted.",
      });
    },
    onError: (error) => {
      toast({
        title: "Failed to delete token",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CreateTokenFormData) => {
    createTokenMutation.mutate(data);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({
      title: "Copied!",
      description: "Token copied to clipboard",
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Failed to load API tokens. Please try again.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Create New Token Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Plus className="h-5 w-5" />
              <span>Create New API Token</span>
            </CardTitle>
            <CardDescription>
              Generate a new API token to access Cronium programmatically
            </CardDescription>
          </CardHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <CardContent>
                <div className="flex space-x-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Enter token name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    disabled={
                      createTokenMutation.isPending || form.formState.isSubmitting
                    }
                  >
                    {createTokenMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Create Token
                  </Button>
                </div>
              </CardContent>
            </form>
          </Form>
        </Card>

        {/* Existing Tokens */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Your API Tokens</h3>

          {!tokens || tokens.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-muted-foreground text-center">
                  <Calendar className="mx-auto mb-4 h-12 w-12 opacity-50" />
                  <p>No API tokens created yet</p>
                  <p className="text-sm">
                    Create your first token to get started
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {tokens.map((token) => (
                <Card key={token.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">
                          {token.name}
                        </CardTitle>
                        <CardDescription className="mt-1 flex items-center space-x-4">
                          <span className="flex items-center">
                            <Calendar className="mr-1 h-3 w-3" />
                            Created {formatDate(token.createdAt)}
                          </span>
                          {token.lastUsed && (
                            <span className="flex items-center">
                              <Clock className="mr-1 h-3 w-3" />
                              Last used {formatDate(token.lastUsed)}
                            </span>
                          )}
                        </CardDescription>
                      </div>
                      <StatusBadge status={token.status} label={token.status} />
                    </div>
                  </CardHeader>
                  <CardFooter className="flex justify-between">
                    <div className="text-muted-foreground text-sm">
                      {token.expiresAt ? (
                        <span>Expires {formatDate(token.expiresAt)}</span>
                      ) : (
                        <span>Never expires</span>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      {token.status === "ACTIVE" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            revokeTokenMutation.mutate({ id: token.id })
                          }
                          disabled={revokeTokenMutation.isPending}
                        >
                          {revokeTokenMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Revoke"
                          )}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          deleteTokenMutation.mutate({ id: token.id })
                        }
                        disabled={deleteTokenMutation.isPending}
                        className="text-red-600 hover:text-red-700"
                      >
                        {deleteTokenMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New Token Dialog */}
      <Dialog
        open={showNewTokenDialog && !!newToken}
        onOpenChange={(open) => {
          if (!open) {
            setShowNewTokenDialog(false);
            setNewToken(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your New API Token</DialogTitle>
            <DialogDescription>
              Copy this token and store it safely. You won't be able to see it
              again.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Important</AlertTitle>
              <AlertDescription>
                This token will only be shown once. Make sure to copy it now.
              </AlertDescription>
            </Alert>

            <div className="flex items-center space-x-2">
              <Input
                value={newToken || ""}
                readOnly
                className="font-mono text-sm"
              />
              <Button
                size="sm"
                onClick={() => newToken && copyToClipboard(newToken)}
                className="shrink-0"
              >
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                setShowNewTokenDialog(false);
                setNewToken(null);
              }}
            >
              I've copied the token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
