import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import { Callout } from "@/components/docs/callout";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Bot, Key, ShieldCheck, Timer } from "lucide-react";
import ApiCodeExamples, {
  CodeBlock,
  SimpleCodeBlock,
} from "@/components/docs/api-code-examples";
import {
  authenticationExamples,
  ciWaitForRun,
  errorExamples,
  eventEndpoints,
  logEndpoints,
  runEndpoints,
  serverEndpoints,
  type ApiEndpoint,
} from "./examples";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "REST API",
  description:
    "Cronium REST API reference: trigger event and workflow runs from CI with an API token, manage events and servers, and read logs.",
  alternates: { canonical: "/docs/api" },
};

const tableOfContents = [
  { title: "Authentication", href: "#authentication", level: 2 },
  { title: "Running from CI", href: "#running-from-ci", level: 2 },
  {
    title: "Waiting for the result",
    href: "#waiting-for-the-result",
    level: 3,
  },
  { title: "Events", href: "#events", level: 2 },
  { title: "Logs", href: "#logs", level: 2 },
  { title: "Servers", href: "#servers", level: 2 },
  { title: "Everything else", href: "#everything-else", level: 2 },
  { title: "Responses and errors", href: "#responses-and-errors", level: 2 },
];

const statusCodes: Array<[number, string]> = [
  [200, "Success"],
  [201, "Created"],
  [202, "Run queued"],
  [204, "Deleted, with no response body"],
  [400, "Invalid ID, body or field, or the SSH connection failed"],
  [401, "Token missing, unknown, revoked or expired"],
  [403, "The token's scope, its owner's role, or ownership does not allow it"],
  [404, "No such event, workflow, server or log"],
  [405, "The route does not support that method"],
  [409, "The run could not start, and the response says why"],
  [
    413,
    "Run input over 1 MB, or saving an event with a request over 10 MB. A reverse proxy in front of Cronium can answer 413 first, with a body of its own that may not be JSON",
  ],
  [
    429,
    "Too many run requests, or too many connection checks to servers and tools; see Retry-After",
  ],
  [500, "Server error"],
];

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function APISection({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section id={id} className="mb-12">
      <h2 className="mb-4 text-2xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function methodBadgeClass(method: ApiEndpoint["method"]): string {
  switch (method) {
    case "GET":
      return "bg-info text-info-foreground border-transparent";
    case "POST":
      return "bg-success text-success-foreground border-transparent";
    case "PUT":
    case "PATCH":
      return "bg-warning text-warning-foreground border-transparent";
    case "DELETE":
      return "bg-destructive text-destructive-foreground border-transparent";
  }
}

function EndpointCard({ endpoint }: { endpoint: ApiEndpoint }) {
  const { method, path, description, scopes, parameters, status } = endpoint;
  const { response, notes, example } = endpoint;

  return (
    <Accordion type="single" collapsible className="mb-1">
      <AccordionItem
        value={`endpoint-${method}-${path}`}
        className="bg-secondary-bg rounded-lg border"
      >
        <AccordionTrigger className="px-6 py-3 hover:no-underline">
          <div className="flex w-full flex-wrap items-center gap-2">
            <Badge className={methodBadgeClass(method)}>{method}</Badge>
            <code className="bg-muted rounded px-2 py-1 text-sm break-all">
              {path}
            </code>
            <span className="text-muted-foreground w-full text-left text-sm sm:mr-4 sm:ml-auto sm:w-auto">
              {description}
            </span>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-6 pb-6">
          <div className="mb-6">
            <h4 className="mb-3 font-semibold">Example</h4>
            <CodeBlock examples={example} />
          </div>

          <div className="mb-4 flex items-center gap-2">
            <h4 className="font-semibold">Token scopes</h4>
            {scopes.map((scope) => (
              <Badge key={scope} variant="outline">
                {scope}
              </Badge>
            ))}
          </div>

          {parameters && (
            <div className="mb-4">
              <h4 className="mb-2 font-semibold">Parameters</h4>
              <div className="space-y-2">
                {parameters.map((param) => (
                  <div
                    key={param.name}
                    className="border-primary border-l-2 pl-3"
                  >
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm">{param.name}</code>
                      <Badge variant="outline">{param.type}</Badge>
                      <span className="text-muted-foreground text-xs">
                        {param.in}
                      </span>
                      {param.required && (
                        <Badge variant="destructive" className="text-xs">
                          Required
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {param.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-4">
            <h4 className="mb-2 font-semibold">Response: {status}</h4>
            {notes && (
              <p className="text-muted-foreground mb-2 text-sm">{notes}</p>
            )}
            {response !== undefined ? (
              <SimpleCodeBlock language="json">
                {formatJson(response)}
              </SimpleCodeBlock>
            ) : (
              <p className="text-muted-foreground text-sm">No response body.</p>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

// Enable Partial Prerendering for this page
export const experimental_ppr = true;

// ISR configuration - revalidate every hour
export const revalidate = 3600; // 1 hour
export const dynamic = "force-static";
export default function APIDocsPage() {
  return (
    <DocsLayout tableOfContents={tableOfContents}>
      <ApiCodeExamples>
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <h1 className="mb-4 text-4xl font-bold tracking-tight">REST API</h1>
            <p className="text-muted-foreground mb-4 text-xl">
              Start runs from CI, manage events and servers, and read logs.
            </p>
            <p>
              The REST API is small on purpose. Most programmatic work,
              including everything about workflows except starting a run, goes
              through{" "}
              <a href="/docs/mcp" className="text-primary hover:underline">
                MCP
              </a>
              . Paths on this page are relative to your instance, such as{" "}
              <code>https://cronium.example.com</code>.
            </p>
          </div>

          <APISection title="Authentication" id="authentication">
            <p className="mb-6">
              Every route on this page needs an API token. Each token belongs to
              the account that created it and carries a scope that limits what
              it can reach.
            </p>

            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  Creating a token
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="text-muted-foreground list-inside list-decimal space-y-2 text-sm">
                  <li>
                    In Cronium, go to <strong>Settings</strong> and open the{" "}
                    <strong>API Tokens</strong> tab.
                  </li>
                  <li>
                    Enter a name and how many days the token should last, up to
                    90.
                  </li>
                  <li>
                    To limit it to the <code>mcp</code> scope, turn on{" "}
                    <strong>Limit to MCP</strong>. Otherwise it gets the{" "}
                    <code>full</code> scope.
                  </li>
                  <li>
                    Select <strong>Create Token</strong> and copy the token. It
                    is shown only once.
                  </li>
                </ol>
              </CardContent>
            </Card>

            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" />
                  What a token can do
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-muted-foreground list-inside list-disc space-y-2 text-sm">
                  <li>
                    A <code>full</code> token can use every route on this page.
                  </li>
                  <li>
                    An <code>mcp</code> token can start runs, manage events, and
                    list servers. It cannot read logs or use the other server
                    routes, and it sees env var keys without their values.
                  </li>
                  <li>
                    A token with neither scope gets a 403. Older tokens created
                    before scopes existed are in this group, so replace them.
                  </li>
                  <li>
                    A token cannot exceed its owner. A Viewer account can only
                    read, and only the owner can run, change or delete an event,
                    workflow or server. Sharing lets other users view and fork
                    an event, not run it.
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Using a token</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4">
                  Send it in the <code>Authorization</code> header:
                </p>
                <CodeBlock examples={authenticationExamples.usingApiTokens} />
              </CardContent>
            </Card>
          </APISection>

          <APISection title="Running from CI" id="running-from-ci">
            <p className="mb-6">
              These two routes start a run and answer as soon as it is queued. A{" "}
              <code>202</code> means the run is on its way, not that it
              succeeded.
            </p>

            {runEndpoints.map((endpoint) => (
              <EndpointCard key={endpoint.path} endpoint={endpoint} />
            ))}

            <Callout variant="info" className="mt-6 text-sm">
              <ul className="space-y-1">
                <li>
                  They accept API tokens only. A browser session gets a 401.
                </li>
                <li>
                  Each allows 50 requests per minute per account. Over that, the
                  response is a 429 with a <code>Retry-After</code> header. The
                  event route shares its budget with running events in the app.
                </li>
              </ul>
            </Callout>

            <h3
              id="waiting-for-the-result"
              className="mt-8 mb-3 flex items-center gap-2 text-xl font-semibold"
            >
              <Timer className="h-5 w-5" />
              Waiting for the result
            </h3>
            <p className="mb-4">
              To fail a CI job when the run fails, follow its log until it
              finishes. Reading logs needs a <code>full</code> token. If your
              job only starts the run, an <code>mcp</code> token is enough.
            </p>
            <SimpleCodeBlock language="bash">{ciWaitForRun}</SimpleCodeBlock>
            <p className="mt-4">
              REST has no route for the status of a workflow run. Pass the{" "}
              <code>executionId</code> to the <code>get_execution</code>{" "}
              <a href="/docs/mcp" className="text-primary hover:underline">
                MCP
              </a>{" "}
              tool, or read each step&apos;s log with{" "}
              <code>{"GET /api/logs?workflowId={id}"}</code>.
            </p>
          </APISection>

          <APISection title="Events" id="events">
            {eventEndpoints.map((endpoint) => (
              <EndpointCard
                key={`${endpoint.method} ${endpoint.path}`}
                endpoint={endpoint}
              />
            ))}
          </APISection>

          <APISection title="Logs" id="logs">
            <p className="mb-6">
              Each run writes a log. You can only read the logs of your own
              events. Sharing an event does not share its logs.
            </p>
            {logEndpoints.map((endpoint) => (
              <EndpointCard key={endpoint.path} endpoint={endpoint} />
            ))}
          </APISection>

          <APISection title="Servers" id="servers">
            <p className="mb-6">
              Credentials are write-only. Responses never contain an SSH key or
              password, only <code>hasPrivateKey</code> and{" "}
              <code>hasPassword</code>.
            </p>
            <p className="mb-6">
              Adding a server, or giving one a new key, connects to it first.
              Each account can have 8 such connections under way at once,
              counting its server and tool checks in the app, with up to 64 more
              waiting their turn for up to 15 seconds, and can start 60 a
              minute. Past that the response is a 429 that says which limit was
              reached, with a <code>Retry-After</code> header for the minute.
            </p>
            {serverEndpoints.map((endpoint) => (
              <EndpointCard
                key={`${endpoint.method} ${endpoint.path}`}
                endpoint={endpoint}
              />
            ))}
          </APISection>

          <APISection title="Everything else" id="everything-else">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  Use MCP
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4">
                  There are no REST routes for these. The same API tokens work
                  with the{" "}
                  <a href="/docs/mcp" className="text-primary hover:underline">
                    MCP server
                  </a>
                  , whose tools cover them:
                </p>
                <ul className="text-muted-foreground mb-4 list-inside list-disc space-y-2 text-sm">
                  <li>
                    List, read, create, change or delete workflows:{" "}
                    <code>list_workflows</code>, <code>get_workflow</code>,{" "}
                    <code>create_workflow</code>, <code>update_workflow</code>,{" "}
                    <code>delete_workflow</code>
                  </li>
                  <li>
                    Follow workflow runs: <code>get_executions</code>,{" "}
                    <code>get_execution</code>
                  </li>
                  <li>
                    Create events and a workflow in one step:{" "}
                    <code>create_workflow_bundle</code>
                  </li>
                </ul>
                <p>
                  User variables have no API. Manage them under{" "}
                  <strong>Settings</strong> in the <strong>Variables</strong>{" "}
                  tab, and read them from scripts with the{" "}
                  <a
                    href="/docs/runtime-helpers"
                    className="text-primary hover:underline"
                  >
                    runtime helpers
                  </a>
                  .
                </p>
              </CardContent>
            </Card>
          </APISection>

          <APISection title="Responses and errors" id="responses-and-errors">
            <p className="mb-6">
              Responses are plain JSON: the resource itself, or an array from a
              list route. There is no wrapper around them. Times are ISO 8601 in
              UTC. The examples show the fields most clients read, and the real
              responses may include more.
            </p>

            <Card>
              <CardHeader>
                <CardTitle>Errors</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4">
                  An error has an <code>error</code> message:
                </p>
                <SimpleCodeBlock language="json">
                  {formatJson(errorExamples.general)}
                </SimpleCodeBlock>

                <p className="my-4">
                  A body that fails validation adds <code>details</code>, with
                  field errors under the field&apos;s name and request-wide
                  errors under <code>_errors</code>. Unknown fields are rejected
                  rather than ignored.
                </p>
                <SimpleCodeBlock language="json">
                  {formatJson(errorExamples.validation)}
                </SimpleCodeBlock>

                <p className="my-4">
                  A path that does not exist under <code>/api</code> answers
                  with:
                </p>
                <SimpleCodeBlock language="json">
                  {formatJson(errorExamples.unknownRoute)}
                </SimpleCodeBlock>

                <div className="mt-6">
                  <h4 className="mb-3 font-semibold">Status codes</h4>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {statusCodes.map(([code, meaning]) => (
                      <div key={code} className="flex items-center gap-3">
                        <Badge {...(code >= 400 && { variant: "destructive" })}>
                          {code}
                        </Badge>
                        <span className="text-sm">{meaning}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </APISection>
        </div>
      </ApiCodeExamples>
    </DocsLayout>
  );
}
