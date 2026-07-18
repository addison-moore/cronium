import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import { Bot, ShieldCheck, Wrench, ListChecks } from "lucide-react";
import { SimpleCodeBlock } from "@/components/docs/api-code-examples";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MCP — Create Events & Workflows with AI",
  description:
    "Connect an AI app (Claude, and other MCP clients) to Cronium via the Model Context Protocol to draft and create events and workflows from natural language.",
  alternates: { canonical: "/docs/mcp" },
};

const tableOfContents = [
  { title: "Overview", href: "#overview", level: 2 },
  { title: "How it works", href: "#how-it-works", level: 2 },
  { title: "Connect from the Claude web app", href: "#remote", level: 2 },
  { title: "Connect from Claude Desktop / Code", href: "#local", level: 2 },
  { title: "Tools the AI can use", href: "#tools", level: 2 },
  { title: "Authentication & scopes", href: "#auth", level: 2 },
  { title: "Safety: drafts, approval, provenance", href: "#safety", level: 2 },
  { title: "Other MCP clients", href: "#clients", level: 2 },
];

export default function McpPage() {
  return (
    <DocsLayout tableOfContents={tableOfContents}>
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <div className="mb-4 flex items-center gap-3">
            <div className="bg-primary/10 rounded-lg p-2">
              <Bot className="text-primary h-6 w-6" />
            </div>
            <h1 className="text-4xl font-bold tracking-tight">
              MCP — build automations with AI
            </h1>
          </div>
          <p className="text-muted-foreground text-xl">
            Connect an AI assistant to your Cronium instance and create events
            and workflows from plain language — it drafts them, you approve,
            Cronium creates them.
          </p>
        </div>

        {/* Overview */}
        <section id="overview" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Overview</h2>
          <div className="prose prose-gray dark:prose-invert mb-6 max-w-none">
            <p>
              Cronium ships a{" "}
              <a
                href="https://modelcontextprotocol.io"
                target="_blank"
                rel="noreferrer"
              >
                Model Context Protocol
              </a>{" "}
              (MCP) server, so any MCP-capable AI app can build automations for
              you. You describe what you want; the assistant reads your
              Cronium&apos;s capabilities (tool types, your saved credentials,
              scheduling rules), drafts the events and workflow — filling in
              sensible defaults — and, once you approve, creates them.
            </p>
            <p>For example, you can say:</p>
            <blockquote>
              &ldquo;Create a workflow in Cronium: a SQL event that counts the
              users in the <code>users</code> database, then a Slack event that
              posts the count to #general at 8am every day.&rdquo;
            </blockquote>
            <p>
              The assistant creates a two-step workflow — a SQL query feeding a
              scheduled Slack message (<code>0 8 * * *</code>) — with Local
              execution and a 30s timeout filled in. Everything lands as a{" "}
              <strong>draft</strong> you review and activate.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">How it works</h2>
          <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Wrench className="h-5 w-5 text-blue-500" />
                  Discover
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  The assistant reads your tool credentials, the available
                  actions, and Cronium&apos;s scheduling rules so it drafts
                  valid config — not guesses.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ListChecks className="h-5 w-5 text-green-500" />
                  Draft &amp; validate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  It can dry-run the plan (schemas, credentials, workflow graph)
                  without changing anything, then show you the draft for
                  approval.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="h-5 w-5 text-purple-500" />
                  Create as drafts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  On your approval it creates the events and workflow — as
                  drafts, so nothing runs until you review and activate them in
                  Cronium.
                </p>
              </CardContent>
            </Card>
          </div>
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <p>
              There are two ways to connect, depending on which AI app you use.
            </p>
          </div>
        </section>

        {/* Remote */}
        <section id="remote" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">
            Connect from the Claude web app
          </h2>
          <div className="prose prose-gray dark:prose-invert mb-4 max-w-none">
            <p>
              Add a <strong>custom connector</strong> in Claude pointing at your
              instance:
            </p>
          </div>
          <SimpleCodeBlock language="text">
            {`https://your-cronium-host/api/mcp`}
          </SimpleCodeBlock>
          <div className="prose prose-gray dark:prose-invert mt-4 max-w-none">
            <p>
              Cronium is a full <strong>OAuth 2.1</strong> authorization server
              for this connector, so you just click <em>Connect</em>, sign in to
              Cronium, and approve — no token to paste. (Any tier of the Claude
              apps can add a custom connector; a paid plan is needed for more
              than one.) Alternatively, authenticate with a{" "}
              <strong>bearer API token</strong> as a custom header. Your
              instance must be reachable over HTTPS.
            </p>
          </div>
        </section>

        {/* Local */}
        <section id="local" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">
            Connect from Claude Desktop or Claude Code
          </h2>
          <div className="prose prose-gray dark:prose-invert mb-4 max-w-none">
            <p>
              For local clients, run the bundled stdio server (
              <code>apps/cronium-mcp</code> in the Cronium repo) and point it at
              your instance with an API token. Claude Desktop —{" "}
              <code>claude_desktop_config.json</code>:
            </p>
          </div>
          <SimpleCodeBlock language="json">
            {`{
  "mcpServers": {
    "cronium": {
      "command": "node",
      "args": ["/path/to/apps/cronium-mcp/dist/index.js"],
      "env": {
        "CRONIUM_BASE_URL": "http://localhost:5001",
        "CRONIUM_API_TOKEN": "<your-token>"
      }
    }
  }
}`}
          </SimpleCodeBlock>
          <div className="prose prose-gray dark:prose-invert mt-4 max-w-none">
            <p>Claude Code:</p>
          </div>
          <SimpleCodeBlock language="bash">
            {`claude mcp add cronium \\
  --env CRONIUM_BASE_URL=http://localhost:5001 \\
  --env CRONIUM_API_TOKEN=<your-token> \\
  -- node /path/to/apps/cronium-mcp/dist/index.js`}
          </SimpleCodeBlock>
        </section>

        {/* Tools */}
        <section id="tools" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Tools the AI can use</h2>
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <ul>
              <li>
                <strong>get_capabilities</strong> — the enums, defaults,
                scheduling guidance, available tool actions, and your real
                credential/server ids.
              </li>
              <li>
                <strong>validate_plan</strong> — dry-run a draft (events +
                optional workflow) without creating anything.
              </li>
              <li>
                <strong>create_event</strong> / <strong>activate_event</strong>{" "}
                — create a single event (as a draft) and, for scheduled events,
                start it.
              </li>
              <li>
                <strong>create_workflow</strong> — wire existing events into a
                workflow.
              </li>
              <li>
                <strong>create_workflow_bundle</strong> — create several events{" "}
                <em>and</em> a workflow chaining them, in one step.
              </li>
            </ul>
          </div>
        </section>

        {/* Auth */}
        <section id="auth" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">
            Authentication &amp; scopes
          </h2>
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <p>
              The remote connector can use OAuth (recommended) or a bearer API
              token; the local server uses an API token. Create a token under{" "}
              <strong>Settings → API Tokens</strong>. When you create one, turn
              on <strong>&ldquo;Limit to MCP&rdquo;</strong> to make it
              least-privilege: such a token (and any OAuth connection) can only
              create and manage events and workflows — it can&apos;t touch the
              rest of your account, so a leaked connector token is contained.
            </p>
          </div>
        </section>

        {/* Safety */}
        <section id="safety" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">
            Safety: drafts, approval, provenance
          </h2>
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <ul>
              <li>
                <strong>Everything is created as a draft.</strong> Nothing runs
                until you review it and activate it in Cronium.
              </li>
              <li>
                <strong>Approval is in your hands.</strong> The assistant shows
                you the plan first; it only creates after you say so, and local
                clients also prompt before each action.
              </li>
              <li>
                <strong>Provenance.</strong> Events and workflows created via
                MCP are tagged <code>source = &quot;mcp&quot;</code> and logged,
                so you can always tell what an AI agent created.
              </li>
              <li>
                <strong>Scoping.</strong> Use an MCP-limited token/connection so
                the assistant can never act beyond creating automations.
              </li>
            </ul>
          </div>
        </section>

        {/* Other clients */}
        <section id="clients" className="mb-12">
          <h2 className="mb-6 text-2xl font-bold">Other MCP clients</h2>
          <div className="prose prose-gray dark:prose-invert max-w-none">
            <p>
              MCP is an open standard, so the same server works with other
              MCP-capable clients (e.g. ChatGPT&apos;s custom connectors on
              Business/Enterprise plans, and developer tools like Cursor and VS
              Code). Remote clients use the <code>/api/mcp</code> endpoint;
              clients that support local servers can run the bundled stdio
              server.
            </p>
          </div>
        </section>
      </div>
    </DocsLayout>
  );
}
