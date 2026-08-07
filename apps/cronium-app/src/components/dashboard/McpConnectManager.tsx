"use client";

/**
 * Settings → Connect AI: onboarding card for the MCP surface.
 *
 * Shows this instance's /api/mcp endpoint, mints an MCP-scoped API token in
 * one click, and provides copy-paste setup snippets for claude.ai (remote
 * OAuth connector), Claude Code, Claude Desktop (both via the published
 * `@cronium/mcp-server` npx bridge), and other HTTP MCP clients.
 *
 * The minted token is shown once (same contract as ApiTokensManager) and, while
 * it remains in memory on this page, is substituted into the snippets so the
 * whole config can be copied ready-to-paste.
 */

import React, { useEffect, useState } from "react";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  TerminalSquare,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from "@cronium/ui";
import { trpc } from "@/lib/trpc";

const copy = {
  title: "Connect an AI (MCP)",
  description:
    "Let an AI assistant build automations in this Cronium instance over the " +
    "Model Context Protocol: it drafts events and workflows, runs them, reads " +
    "the results, fixes what's broken, and activates them — you approve each step.",
  endpointLabel: "Your MCP endpoint",
  endpointNote:
    "Remote clients (the claude.ai web app and other HTTP MCP clients) connect " +
    "to this URL directly. claude.ai requires it to be reachable over HTTPS; " +
    "for a localhost instance use a local client below instead.",
  tokenTitle: "Create an MCP-scoped token",
  tokenDescription:
    "Local clients authenticate with an API token. This mints one limited to " +
    "the MCP tool surface (create/run/fix events & workflows — no account " +
    "access), expiring in 90 days.",
  tokenNamePlaceholder: "Token name",
  tokenDefaultName: "AI connector",
  mintButton: "Create MCP token",
  tokenOnceTitle: "Copy your token now",
  tokenOnceBody:
    "It won't be shown again after you leave this page. It's also filled into " +
    "the snippets below so you can copy a ready-to-paste config.",
  manageTokens: "Manage existing tokens",
  snippetsTitle: "Set up your client",
  snippetsDescription:
    "Pick your AI app. Snippets use this instance's URL — and your new token, " +
    "once you mint one above.",
  docsLink: "Full MCP documentation",
} as const;

const TOKEN_PLACEHOLDER = "<your-token>";

function CopyButton({
  value,
  label,
  copiedKey,
  onCopied,
}: {
  value: string;
  label: string;
  copiedKey: string | null;
  onCopied: (key: string) => void;
}) {
  const isCopied = copiedKey === label;
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value);
        onCopied(label);
        toast({
          title: "Copied!",
          description: `${label} copied to clipboard`,
          variant: "info",
        });
      }}
    >
      {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function Snippet({
  label,
  value,
  copiedKey,
  onCopied,
}: {
  label: string;
  value: string;
  copiedKey: string | null;
  onCopied: (key: string) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <pre className="bg-muted min-w-0 flex-1 overflow-x-auto rounded-md p-4 text-sm">
        <code>{value}</code>
      </pre>
      <CopyButton
        value={value}
        label={label}
        copiedKey={copiedKey}
        onCopied={onCopied}
      />
    </div>
  );
}

export default function McpConnectManager() {
  // window is unavailable during prerender; resolve the origin client-side.
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const [tokenName, setTokenName] = useState<string>(copy.tokenDefaultName);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!copiedKey) return;
    const timer = setTimeout(() => setCopiedKey(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedKey]);

  const createTokenMutation = trpc.auth.createApiToken.useMutation({
    onSuccess: (data) => {
      setMintedToken(data.displayToken);
      toast({
        title: "MCP token created",
        description: "Copy it now — it won't be shown again.",
        variant: "success",
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

  const endpointUrl = origin ? `${origin}/api/mcp` : "…";
  const baseUrl = origin || "https://<your-instance>";
  const token = mintedToken ?? TOKEN_PLACEHOLDER;

  const claudeCodeSnippet = [
    "claude mcp add cronium \\",
    `  --env CRONIUM_BASE_URL=${baseUrl} \\`,
    `  --env CRONIUM_API_TOKEN=${token} \\`,
    "  -- npx -y @cronium/mcp-server",
  ].join("\n");

  const claudeDesktopSnippet = JSON.stringify(
    {
      mcpServers: {
        cronium: {
          command: "npx",
          args: ["-y", "@cronium/mcp-server"],
          env: {
            CRONIUM_BASE_URL: baseUrl,
            CRONIUM_API_TOKEN: token,
          },
        },
      },
    },
    null,
    2,
  );

  const curlSnippet = [
    `curl -s ${endpointUrl} \\`,
    `  -H "authorization: Bearer ${token}" \\`,
    '  -H "content-type: application/json" \\',
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
  ].join("\n");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Bot className="h-5 w-5" />
            <span>{copy.title}</span>
          </CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label className="flex items-center gap-1.5">
            <Globe className="h-4 w-4" />
            {copy.endpointLabel}
          </Label>
          <div className="flex items-center gap-2">
            <Input value={endpointUrl} readOnly className="font-mono text-sm" />
            <CopyButton
              value={endpointUrl}
              label="Endpoint URL"
              copiedKey={copiedKey}
              onCopied={setCopiedKey}
            />
          </div>
          <p className="text-muted-foreground text-sm">{copy.endpointNote}</p>
          <a
            href="https://cronium.app/docs/mcp"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 text-sm underline"
          >
            {copy.docsLink}
            <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <KeyRound className="h-5 w-5" />
            <span>{copy.tokenTitle}</span>
          </CardTitle>
          <CardDescription>{copy.tokenDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder={copy.tokenNamePlaceholder}
              className="max-w-xs"
            />
            <Button
              type="button"
              onClick={() =>
                createTokenMutation.mutate({
                  name: tokenName.trim() || copy.tokenDefaultName,
                  scopes: ["mcp"],
                  expiresInDays: 90,
                })
              }
              disabled={createTokenMutation.isPending}
            >
              {createTokenMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 motion-safe:animate-spin" />
              ) : (
                <KeyRound className="mr-2 h-4 w-4" />
              )}
              {copy.mintButton}
            </Button>
          </div>

          {mintedToken && (
            <Alert>
              <KeyRound className="h-4 w-4" />
              <AlertTitle>{copy.tokenOnceTitle}</AlertTitle>
              <AlertDescription>
                <p className="mb-2">{copy.tokenOnceBody}</p>
                <div className="flex items-center gap-2">
                  <Input
                    value={mintedToken}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <CopyButton
                    value={mintedToken}
                    label="API token"
                    copiedKey={copiedKey}
                    onCopied={setCopiedKey}
                  />
                </div>
              </AlertDescription>
            </Alert>
          )}

          <button
            type="button"
            className="text-primary text-sm underline"
            onClick={() => {
              window.location.hash = "api-tokens";
            }}
          >
            {copy.manageTokens}
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TerminalSquare className="h-5 w-5" />
            <span>{copy.snippetsTitle}</span>
          </CardTitle>
          <CardDescription>{copy.snippetsDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="claude-web" className="space-y-4">
            <TabsList>
              <TabsTrigger value="claude-web">claude.ai</TabsTrigger>
              <TabsTrigger value="claude-code">Claude Code</TabsTrigger>
              <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
              <TabsTrigger value="other">Other clients</TabsTrigger>
            </TabsList>

            <TabsContent value="claude-web" className="space-y-3">
              <p className="text-muted-foreground text-sm">
                In claude.ai:{" "}
                <strong>Settings → Connectors → Add custom connector</strong>,
                paste your endpoint URL, and click <strong>Connect</strong> —
                you&apos;ll be sent here to sign in and approve (OAuth; no token
                to paste). Requires the instance to be reachable from the
                internet over HTTPS.
              </p>
              <Snippet
                label="Connector URL"
                value={endpointUrl}
                copiedKey={copiedKey}
                onCopied={setCopiedKey}
              />
            </TabsContent>

            <TabsContent value="claude-code" className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Runs the published{" "}
                <code className="bg-muted rounded px-1">
                  @cronium/mcp-server
                </code>{" "}
                bridge via npx — no install, works with localhost instances.
              </p>
              <Snippet
                label="Claude Code command"
                value={claudeCodeSnippet}
                copiedKey={copiedKey}
                onCopied={setCopiedKey}
              />
            </TabsContent>

            <TabsContent value="claude-desktop" className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Add to{" "}
                <code className="bg-muted rounded px-1">
                  claude_desktop_config.json
                </code>{" "}
                (macOS:{" "}
                <code className="bg-muted rounded px-1">
                  ~/Library/Application Support/Claude/
                </code>
                ), then restart Claude Desktop.
              </p>
              <Snippet
                label="Claude Desktop config"
                value={claudeDesktopSnippet}
                copiedKey={copiedKey}
                onCopied={setCopiedKey}
              />
            </TabsContent>

            <TabsContent value="other" className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Any MCP client that supports remote servers (Streamable HTTP,
                stateless JSON) can connect to the endpoint with an{" "}
                <code className="bg-muted rounded px-1">
                  Authorization: Bearer
                </code>{" "}
                header. Quick check:
              </p>
              <Snippet
                label="curl example"
                value={curlSnippet}
                copiedKey={copiedKey}
                onCopied={setCopiedKey}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
