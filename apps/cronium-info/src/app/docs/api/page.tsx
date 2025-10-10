import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@cronium/ui";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@cronium/ui";
import { Badge } from "@cronium/ui";
import { Key, ShieldCheck, Copy } from "lucide-react";
import ApiCodeExamples, {
  CodeBlock,
} from "@/components/docs/api-code-examples";
import {
  authenticationExamples,
  eventsApiExamples,
  workflowsApiExamples,
  serversApiExamples,
  variablesApiExamples,
  responseExamples,
} from "./examples";

const tableOfContents = [
  { title: "Authentication", href: "#authentication", level: 2 },
  { title: "Creating API Keys", href: "#creating-api-keys", level: 3 },
  { title: "Using API Keys", href: "#using-api-keys", level: 3 },
  { title: "Events API", href: "#events-api", level: 2 },
  { title: "List Events", href: "#list-events", level: 3 },
  { title: "Get Event", href: "#get-event", level: 3 },
  { title: "Create Event", href: "#create-event", level: 3 },
  { title: "Update Event", href: "#update-event", level: 3 },
  { title: "Delete Event", href: "#delete-event", level: 3 },
  { title: "Execute Event", href: "#execute-event", level: 3 },
  { title: "Get Event Logs", href: "#get-event-logs", level: 3 },
  { title: "Workflows API", href: "#workflows-api", level: 2 },
  { title: "List Workflows", href: "#list-workflows", level: 3 },
  { title: "Get Workflow", href: "#get-workflow", level: 3 },
  { title: "Create Workflow", href: "#create-workflow", level: 3 },
  { title: "Update Workflow", href: "#update-workflow", level: 3 },
  { title: "Execute Workflow", href: "#execute-workflow", level: 3 },
  { title: "Servers API", href: "#servers-api", level: 2 },
  { title: "Variables API", href: "#variables-api", level: 2 },
  { title: "List Variables", href: "#list-variables", level: 3 },
  { title: "Get Variable", href: "#get-variable", level: 3 },
  { title: "Create Variable", href: "#create-variable", level: 3 },
  { title: "Update Variable", href: "#update-variable", level: 3 },
  { title: "Delete Variable", href: "#delete-variable", level: 3 },
  { title: "Response Formats", href: "#response-formats", level: 2 },
  { title: "Error Handling", href: "#error-handling", level: 2 },
];

function SimpleCodeBlock({
  children,
}: {
  children: string;
  language?: string;
}) {
  return (
    <div className="relative">
      <pre className="border-border overflow-x-auto rounded-lg border bg-stone-900 p-4 text-sm text-gray-100">
        <code>{children}</code>
      </pre>
      <button className="absolute top-2 right-2 p-2 text-gray-400 hover:text-gray-200">
        <Copy className="h-4 w-4" />
      </button>
    </div>
  );
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

function EndpointCard({
  method,
  endpoint,
  description,
  parameters,
  response,
  examples,
}: {
  method: string;
  endpoint: string;
  description: string;
  parameters?: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
  response?: string;
  examples?: { python: string; nodejs: string; curl: string };
}) {
  const accordionId = `endpoint-${method.toLowerCase()}-${endpoint.replace(/[^a-zA-Z0-9]/g, "-")}`;

  return (
    <Accordion type="single" collapsible className="mb-1">
      <AccordionItem
        value={accordionId}
        className="bg-secondary-bg rounded-lg border"
      >
        <AccordionTrigger className="px-6 py-3 hover:no-underline">
          <div className="flex w-full items-center gap-2">
            <Badge
              className={
                method === "GET"
                  ? "border-transparent bg-blue-500 text-white"
                  : method === "POST"
                    ? "border-transparent bg-green-500 text-white"
                    : method === "PUT"
                      ? "border-transparent bg-yellow-500 text-white"
                      : method === "PATCH"
                        ? "border-transparent bg-orange-500 text-white"
                        : "border-transparent bg-red-500 text-white"
              }
            >
              {method}
            </Badge>
            <code className="bg-muted rounded px-2 py-1 text-sm">
              {endpoint}
            </code>
            <span className="text-muted-foreground mr-4 ml-auto text-left text-sm">
              {description}
            </span>
          </div>
        </AccordionTrigger>
        <AccordionContent className="px-6 pb-6">
          {examples && (
            <div className="mb-6">
              <h4 className="mb-3 font-semibold">Example</h4>
              <CodeBlock examples={examples} />
            </div>
          )}

          {parameters && (
            <div className="mb-4">
              <h4 className="mb-2 font-semibold">Parameters</h4>
              <div className="space-y-2">
                {parameters.map((param, index) => (
                  <div key={index} className="border-primary border-l-2 pl-3">
                    <div className="flex items-center gap-2">
                      <code className="font-mono text-sm">{param.name}</code>
                      <Badge variant="outline">{param.type}</Badge>
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

          {response && (
            <div className="mb-4">
              <h4 className="mb-2 font-semibold">Response</h4>
              <SimpleCodeBlock language="json">{response}</SimpleCodeBlock>
            </div>
          )}
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
            <h1 className="mb-4 text-4xl font-bold">API Reference</h1>
            <p className="text-muted-foreground text-xl">
              Complete API documentation for integrating with Cronium
              programmatically.
            </p>
          </div>

          <APISection title="Authentication" id="authentication">
            <div className="mb-6">
              <p className="mb-4">
                Cronium uses API tokens for authentication. All API requests
                must include a valid API token in the Authorization header.
              </p>
            </div>

            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="h-5 w-5" />
                  Creating API Keys
                </CardTitle>
                <CardDescription>
                  Generate API tokens to access the Cronium API
                  programmatically.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">
                      Step 1: Navigate to API Settings
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      Go to your account settings and select the "API Tokens"
                      tab.
                    </p>
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">
                      Step 2: Create New Token
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      Click "Create New Token" and provide a descriptive name
                      for your token.
                    </p>
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">
                      Step 3: Set Permissions
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      Choose the appropriate permissions for your use case:
                    </p>
                    <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1 text-sm">
                      <li>
                        <strong>Read:</strong> View events, workflows, and logs
                      </li>
                      <li>
                        <strong>Write:</strong> Create and modify events and
                        workflows
                      </li>
                      <li>
                        <strong>Execute:</strong> Trigger events and workflows
                      </li>
                      <li>
                        <strong>Admin:</strong> Full access to all resources
                      </li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">
                      Step 4: Copy Your Token
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      Copy the generated token immediately. For security
                      reasons, you won't be able to view it again.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5" />
                  Using API Keys
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4">
                  Include your API token in the Authorization header of every
                  request:
                </p>

                <CodeBlock examples={authenticationExamples.usingApiKeys} />
              </CardContent>
            </Card>
          </APISection>

          <APISection title="Events API" id="events-api">
            <p className="mb-6">
              The Events API allows you to manage and execute automated scripts
              and events.
            </p>

            <EndpointCard
              method="GET"
              endpoint="/api/events"
              description="Retrieve a list of all events"
              parameters={[
                {
                  name: "page",
                  type: "integer",
                  required: false,
                  description: "Page number for pagination (default: 1)",
                },
                {
                  name: "limit",
                  type: "integer",
                  required: false,
                  description:
                    "Number of events per page (default: 10, max: 100)",
                },
                {
                  name: "status",
                  type: "string",
                  required: false,
                  description:
                    "Filter by event status (active, inactive, scheduled)",
                },
              ]}
              response={responseExamples.listEventsResponse}
              examples={eventsApiExamples.listEvents}
            />

            <EndpointCard
              method="POST"
              endpoint="/api/events"
              description="Create a new event"
              parameters={[
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "Name of the event",
                },
                {
                  name: "description",
                  type: "string",
                  required: false,
                  description: "Description of the event",
                },
                {
                  name: "type",
                  type: "string",
                  required: true,
                  description:
                    "Event type (BASH, PYTHON, NODEJS, HTTP_REQUEST)",
                },
                {
                  name: "script",
                  type: "string",
                  required: true,
                  description: "Script content to execute",
                },
                {
                  name: "schedule",
                  type: "string",
                  required: false,
                  description: "Cron expression for scheduling",
                },
                {
                  name: "serverId",
                  type: "integer",
                  required: false,
                  description: "ID of the server to execute on",
                },
              ]}
              response={responseExamples.createEventResponse}
              examples={eventsApiExamples.createEvent}
            />

            <EndpointCard
              method="GET"
              endpoint="/api/events/{id}"
              description="Retrieve a specific event by ID"
              parameters={[
                {
                  name: "id",
                  type: "integer",
                  required: true,
                  description: "Event ID",
                },
              ]}
              response={responseExamples.getEventResponse}
              examples={eventsApiExamples.getEvent}
            />

            <EndpointCard
              method="PATCH"
              endpoint="/api/events/{id}"
              description="Update an existing event"
              parameters={[
                {
                  name: "id",
                  type: "integer",
                  required: true,
                  description: "Event ID",
                },
                {
                  name: "name",
                  type: "string",
                  required: false,
                  description: "Event name",
                },
                {
                  name: "description",
                  type: "string",
                  required: false,
                  description: "Event description",
                },
                {
                  name: "content",
                  type: "string",
                  required: false,
                  description: "Script content",
                },
                {
                  name: "status",
                  type: "string",
                  required: false,
                  description: "Event status (ACTIVE, PAUSED, DRAFT)",
                },
                {
                  name: "scheduleNumber",
                  type: "integer",
                  required: false,
                  description: "Schedule interval number",
                },
                {
                  name: "scheduleUnit",
                  type: "string",
                  required: false,
                  description: "Schedule unit (SECONDS, MINUTES, HOURS, DAYS)",
                },
                {
                  name: "timeoutValue",
                  type: "integer",
                  required: false,
                  description: "Execution timeout value",
                },
                {
                  name: "retries",
                  type: "integer",
                  required: false,
                  description: "Number of retry attempts",
                },
              ]}
              examples={eventsApiExamples.updateEvent}
            />

            <EndpointCard
              method="DELETE"
              endpoint="/api/events/{id}"
              description="Delete an event"
              parameters={[
                {
                  name: "id",
                  type: "integer",
                  required: true,
                  description: "Event ID",
                },
              ]}
              response="HTTP 204 No Content"
              examples={eventsApiExamples.deleteEvent}
            />

            <EndpointCard
              method="GET"
              endpoint="/api/events/{id}/logs"
              description="Retrieve logs for a specific event"
              parameters={[
                {
                  name: "id",
                  type: "integer",
                  required: true,
                  description: "Event ID",
                },
                {
                  name: "limit",
                  type: "integer",
                  required: false,
                  description:
                    "Number of logs to retrieve (default: 100, max: 1000)",
                },
                {
                  name: "offset",
                  type: "integer",
                  required: false,
                  description: "Number of logs to skip for pagination",
                },
              ]}
              response={responseExamples.eventLogsResponse}
              examples={eventsApiExamples.getEventLogs}
            />

            <EndpointCard
              method="POST"
              endpoint="/api/events/{id}/execute"
              description="Execute an event immediately"
              parameters={[
                {
                  name: "id",
                  type: "integer",
                  required: true,
                  description: "Event ID",
                },
                {
                  name: "envVars",
                  type: "object",
                  required: false,
                  description: "Environment variables to pass to the script",
                },
                {
                  name: "input",
                  type: "object",
                  required: false,
                  description:
                    "Input data to pass to the script via unified I/O system",
                },
              ]}
              response={responseExamples.executeEventResponse}
              examples={eventsApiExamples.executeEvent}
            />
          </APISection>

          <APISection title="Workflows API" id="workflows-api">
            <p className="mb-6">
              The Workflows API allows you to create and manage complex
              automation workflows with multiple events and conditional logic.
            </p>

            <EndpointCard
              method="GET"
              endpoint="/api/workflows"
              description="Retrieve a list of all workflows"
              parameters={[
                {
                  name: "page",
                  type: "integer",
                  required: false,
                  description: "Page number for pagination",
                },
                {
                  name: "limit",
                  type: "integer",
                  required: false,
                  description: "Number of workflows per page",
                },
              ]}
              response={responseExamples.listWorkflowsResponse}
              examples={workflowsApiExamples.listWorkflows}
            />

            <EndpointCard
              method="GET"
              endpoint="/api/workflows/{id}"
              description="Retrieve a specific workflow by ID with its nodes and connections"
              parameters={[
                {
                  name: "id",
                  type: "integer",
                  required: true,
                  description: "Workflow ID",
                },
              ]}
              examples={workflowsApiExamples.getWorkflow}
            />

            <EndpointCard
              method="POST"
              endpoint="/api/workflows"
              description="Create a new workflow with nodes and connections"
              parameters={[
                {
                  name: "name",
                  type: "string",
                  required: true,
                  description: "Name of the workflow",
                },
                {
                  name: "description",
                  type: "string",
                  required: false,
                  description: "Description of the workflow",
                },
                {
                  name: "triggerType",
                  type: "string",
                  required: true,
                  description: "Trigger type (SCHEDULED, WEBHOOK, MANUAL)",
                },
                {
                  name: "runLocation",
                  type: "string",
                  required: false,
                  description: "Where to run the workflow (LOCAL, REMOTE)",
                },
                {
                  name: "scheduleNumber",
                  type: "integer",
                  required: false,
                  description:
                    "Schedule interval number (for SCHEDULED workflows)",
                },
                {
                  name: "scheduleUnit",
                  type: "string",
                  required: false,
                  description: "Schedule unit (minute, hour, day, week, month)",
                },
                {
                  name: "nodes",
                  type: "array",
                  required: false,
                  description:
                    "Array of workflow nodes with position and event data",
                },
                {
                  name: "edges",
                  type: "array",
                  required: false,
                  description: "Array of connections between nodes",
                },
              ]}
              examples={workflowsApiExamples.createWorkflow}
            />

            <EndpointCard
              method="PATCH"
              endpoint="/api/workflows/{id}"
              description="Update an existing workflow"
              parameters={[
                {
                  name: "id",
                  type: "integer",
                  required: true,
                  description: "Workflow ID",
                },
                {
                  name: "name",
                  type: "string",
                  required: false,
                  description: "Updated name of the workflow",
                },
                {
                  name: "description",
                  type: "string",
                  required: false,
                  description: "Updated description",
                },
                {
                  name: "status",
                  type: "string",
                  required: false,
                  description: "Workflow status (ACTIVE, PAUSED, DRAFT)",
                },
              ]}
              examples={workflowsApiExamples.updateWorkflow}
            />

            <EndpointCard
              method="POST"
              endpoint="/api/workflows/{id}/execute"
              description="Execute a workflow immediately"
              parameters={[
                {
                  name: "id",
                  type: "integer",
                  required: true,
                  description: "Workflow ID",
                },
                {
                  name: "input",
                  type: "object",
                  required: false,
                  description:
                    "Input data to pass to the first workflow node via unified I/O system",
                },
              ]}
              response={responseExamples.executeWorkflowResponse}
              examples={workflowsApiExamples.executeWorkflow}
            />

            <EndpointCard
              method="DELETE"
              endpoint="/api/workflows/{id}"
              description="Delete a workflow and all its related data"
              parameters={[
                {
                  name: "id",
                  type: "integer",
                  required: true,
                  description: "Workflow ID to delete",
                },
              ]}
              response={`{
  "success": true
}`}
              examples={workflowsApiExamples.updateWorkflow}
            />
          </APISection>

          <APISection title="Servers API" id="servers-api">
            <EndpointCard
              method="GET"
              endpoint="/api/servers"
              description="Retrieve a list of all configured servers"
              response={responseExamples.listServersResponse}
              examples={serversApiExamples.listServers}
            />
          </APISection>

          <APISection title="Variables API" id="variables-api">
            <p className="text-muted-foreground mb-6">
              The Variables API allows you to manage user-scoped key-value pairs
              that can be accessed in your scripts using the
              cronium.getVariable() and cronium.setVariable() runtime helpers.
              Variables are encrypted at rest and scoped to the authenticated
              user.
            </p>

            <EndpointCard
              method="GET"
              endpoint="/api/variables"
              description="Retrieve all variables for the authenticated user"
              response={responseExamples.listVariablesResponse}
              examples={variablesApiExamples.listVariables}
            />

            <EndpointCard
              method="POST"
              endpoint="/api/variables"
              description="Create a new variable"
              parameters={[
                {
                  name: "key",
                  type: "string",
                  required: true,
                  description:
                    "Unique identifier for the variable (case-sensitive)",
                },
                {
                  name: "value",
                  type: "string",
                  required: true,
                  description: "Value to store (will be encrypted)",
                },
                {
                  name: "description",
                  type: "string",
                  required: false,
                  description: "Optional description of the variable's purpose",
                },
              ]}
              response={responseExamples.createVariableResponse}
              examples={variablesApiExamples.createVariable}
            />

            <EndpointCard
              method="GET"
              endpoint="/api/variables/{key}"
              description="Retrieve a specific variable by key"
              parameters={[
                {
                  name: "key",
                  type: "string",
                  required: true,
                  description:
                    "Variable key (URL encoded if contains special characters)",
                },
              ]}
              response={responseExamples.getVariableResponse}
              examples={variablesApiExamples.getVariable}
            />

            <EndpointCard
              method="PUT"
              endpoint="/api/variables/{key}"
              description="Update an existing variable"
              parameters={[
                {
                  name: "key",
                  type: "string",
                  required: true,
                  description:
                    "Variable key (URL encoded if contains special characters)",
                },
                {
                  name: "value",
                  type: "string",
                  required: true,
                  description: "New value to store (will be encrypted)",
                },
                {
                  name: "description",
                  type: "string",
                  required: false,
                  description: "Updated description of the variable's purpose",
                },
              ]}
              response={responseExamples.createVariableResponse}
              examples={variablesApiExamples.updateVariable}
            />

            <EndpointCard
              method="DELETE"
              endpoint="/api/variables/{key}"
              description="Delete a variable"
              parameters={[
                {
                  name: "key",
                  type: "string",
                  required: true,
                  description:
                    "Variable key to delete (URL encoded if contains special characters)",
                },
              ]}
              response={`{
  "success": true,
  "message": "Variable deleted successfully"
}`}
              examples={variablesApiExamples.deleteVariable}
            />

            <div className="mt-6 rounded-lg bg-blue-50 p-4 dark:bg-blue-950/20">
              <h4 className="mb-2 font-semibold text-blue-900 dark:text-blue-100">
                Using Variables in Scripts
              </h4>
              <p className="mb-3 text-sm text-blue-700 dark:text-blue-300">
                Variables created via the API can be accessed in your scripts
                using runtime helpers:
              </p>
              <div className="space-y-2">
                <SimpleCodeBlock language="javascript">
                  {`// Node.js
const dbUrl = cronium.getVariable('DATABASE_URL');
cronium.setVariable('LAST_RUN', new Date().toISOString());`}
                </SimpleCodeBlock>
                <SimpleCodeBlock language="python">
                  {`# Python
db_url = cronium.getVariable('DATABASE_URL')
cronium.setVariable('LAST_RUN', datetime.now().isoformat())`}
                </SimpleCodeBlock>
                <SimpleCodeBlock language="bash">
                  {`# Bash
DB_URL=$(cronium.getVariable "DATABASE_URL")
cronium.setVariable "LAST_RUN" "$(date -Iseconds)"`}
                </SimpleCodeBlock>
              </div>
            </div>
          </APISection>

          <APISection title="Response Formats" id="response-formats">
            <Card>
              <CardHeader>
                <CardTitle>Standard Response Format</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4">
                  All API responses follow a consistent format:
                </p>
                <SimpleCodeBlock language="json">{`{
  "success": true,
  "data": {
    // Response data here
  },
  "message": "Operation completed successfully",
  "timestamp": "2024-01-20T16:00:00Z"
}`}</SimpleCodeBlock>
              </CardContent>
            </Card>
          </APISection>

          <APISection title="Error Handling" id="error-handling">
            <Card>
              <CardHeader>
                <CardTitle>Error Response Format</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4">
                  Error responses include detailed information to help with
                  debugging:
                </p>
                <SimpleCodeBlock language="json">
                  {responseExamples.validationError}
                </SimpleCodeBlock>

                <div className="mt-6">
                  <h4 className="mb-3 font-semibold">HTTP Status Codes</h4>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="flex items-center gap-3">
                      <Badge>200</Badge>
                      <span className="text-sm">Success</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge>201</Badge>
                      <span className="text-sm">Created</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="destructive">400</Badge>
                      <span className="text-sm">
                        Bad Request - Invalid parameters
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="destructive">401</Badge>
                      <span className="text-sm">
                        Unauthorized - Invalid API token
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="destructive">403</Badge>
                      <span className="text-sm">
                        Forbidden - Insufficient permissions
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="destructive">404</Badge>
                      <span className="text-sm">
                        Not Found - Resource doesn't exist
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="destructive">429</Badge>
                      <span className="text-sm">
                        Rate Limited - Too many requests
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="destructive">500</Badge>
                      <span className="text-sm">Internal Server Error</span>
                    </div>
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
