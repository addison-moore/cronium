import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Code2, Zap } from "lucide-react";
import ApiCodeExamples, {
  CodeBlock,
  SimpleCodeBlock,
} from "@/components/docs/api-code-examples";

const tableOfContents = [
  { title: "Overview", href: "#overview", level: 2 },
  { title: "Using cronium.input", href: "#cronium-input", level: 2 },
  { title: "Using cronium.output()", href: "#cronium-output", level: 2 },
  { title: "Using cronium.event()", href: "#cronium-event", level: 2 },
  { title: "API Integration", href: "#api-integration", level: 2 },
  { title: "Quick Reference", href: "#quick-reference", level: 2 },
  { title: "Best Practices", href: "#best-practices", level: 2 },
  { title: "Troubleshooting", href: "#troubleshooting", level: 2 },
];

// Code examples with language switching
const runtimeExamples = {
  croniumInput: {
    python: `# cronium is automatically available - no imports needed!

# Access input data directly
input_data = cronium.input()
print(f"Received: {input_data}")

# Access specific fields
user_id = input_data.get('user_id', 'unknown')
action = input_data.get('action', 'default')

# Assign to new variable
new_input = cronium.input()`,
    nodejs: `// cronium is automatically available - no imports needed!

// Access input data directly
const inputData = cronium.input();
console.log('Received:', inputData);

// Access specific fields
const userId = inputData.user_id || 'unknown';
const action = inputData.action || 'default';

// Assign to new variable
const newInput = cronium.input();`,
    curl: `# cronium functions are automatically available - no sourcing needed!

# Access input data directly
input_data=$(cronium_input)
echo "Received: $input_data"

# Parse JSON fields
user_id=$(echo "$input_data" | jq -r '.user_id // "unknown"')
action=$(echo "$input_data" | jq -r '.action // "default"')

# Assign to new variable
new_input=$(cronium_input)`,
  },
  croniumEvent: {
    python: `# cronium is automatically available - no imports needed!

# Access event metadata
event_data = cronium.event()
print(f"Event ID: {event_data.get('id')}")
print(f"Event Name: {event_data.get('name')}")
print(f"Event Type: {event_data.get('type')}")

# Use event info in processing
if event_data.get('type') == 'PYTHON':
    print("Running Python script")
    
# Check server information
server = event_data.get('server')
if server:
    print(f"Running on server: {server.get('name')}")`,
    nodejs: `// cronium is automatically available - no imports needed!

// Access event metadata
const eventData = cronium.event();
console.log('Event ID:', eventData.id);
console.log('Event Name:', eventData.name);
console.log('Event Type:', eventData.type);

// Use event info in processing
if (eventData.type === 'NODEJS') {
    console.log('Running Node.js script');
}

// Check server information
const server = eventData.server;
if (server) {
    console.log(\`Running on server: \${server.name}\`);
}`,
    curl: `# cronium functions are automatically available - no sourcing needed!

# Access event metadata
event_data=$(cronium_event)
echo "Event data: $event_data"

# Parse event fields
event_id=$(echo "$event_data" | jq -r '.id')
event_name=$(echo "$event_data" | jq -r '.name')
event_type=$(echo "$event_data" | jq -r '.type')

echo "Event ID: $event_id"
echo "Event Name: $event_name"
echo "Event Type: $event_type"

# Check server information
server_name=$(echo "$event_data" | jq -r '.server.name // "local"')
echo "Running on server: $server_name"`,
  },
  croniumOutput: {
    python: `# cronium is automatically available - no imports needed!

# Create output data
output_data = {
    "success": True,
    "message": "Processing completed",
    "results": {
        "processed_items": 42,
        "total_time": "2.5s"
    },
    "next_action": "send_notification"
}

# Set output for next workflow node
cronium.output(output_data)`,
    nodejs: `// cronium is automatically available - no imports needed!

// Create output data
const outputData = {
    success: true,
    message: "Processing completed",
    results: {
        processedItems: 42,
        totalTime: "2.5s"
    },
    nextAction: "send_notification"
};

// Set output for next workflow node
cronium.output(outputData);`,
    curl: `# cronium functions are automatically available - no sourcing needed!

# Create output data (JSON string)
output_data='{
    "success": true,
    "message": "Processing completed",
    "results": {
        "processed_items": 42,
        "total_time": "2.5s"
    },
    "next_action": "send_notification"
}'

# Set output for next workflow node
cronium_output "$output_data"`,
  },
  logging: {
    python: `# Use standard Python print for logging
print("Starting data processing...")
print(f"Processing {len(items)} items")
print("Data processing completed successfully")

# Access input if needed (cronium automatically available)
input_data = cronium.input()
if input_data.get('verbose'):
    print(f"Input received: {input_data}")`,
    nodejs: `// Use standard console.log for logging
console.log("Starting data processing...");
console.log(\`Processing \${items.length} items\`);
console.log("Data processing completed successfully");

// Access input if needed (cronium automatically available)
const inputData = cronium.input();
if (inputData.verbose) {
    console.log('Input received:', inputData);
}`,
    curl: `# Use standard echo for logging
echo "Starting data processing..."
echo "Processing $item_count items"
echo "Data processing completed successfully"

# Access input if needed (cronium automatically available)
input_data=$(cronium_input)
if [[ $(echo "$input_data" | jq -r '.verbose // false') == "true" ]]; then
    echo "Input received: $input_data"
fi`,
  },
  apiIntegration: {
    python: `import requests

# Execute event with input data
response = requests.post(
    'https://your-cronium-instance.com/api/events/42/execute',
    headers={
        'Authorization': 'Bearer YOUR_API_TOKEN',
        'Content-Type': 'application/json'
    },
    json={
        "input": {
            "user_id": 123,
            "action": "process_data",
            "data": {"items": ["item1", "item2"]}
        }
    }
)

result = response.json()
print(f"Execution result: {result}")`,
    nodejs: `const fetch = require('node-fetch');

// Execute event with input data
const response = await fetch(
    'https://your-cronium-instance.com/api/events/42/execute',
    {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer YOUR_API_TOKEN',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            input: {
                user_id: 123,
                action: "process_data",
                data: {items: ["item1", "item2"]}
            }
        })
    }
);

const result = await response.json();
console.log('Execution result:', result);`,
    curl: `curl -X POST \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "input": {
      "user_id": 123,
      "action": "process_data",
      "data": {"items": ["item1", "item2"]}
    }
  }' \\
  https://your-cronium-instance.com/api/events/42/execute`,
  },
  quickReference: {
    python: `# cronium is automatically available - no imports needed!

# Access input
user_data = cronium.input()
print(f"Processing for user: {user_data.get('name', 'unknown')}")

# Access event metadata
event_data = cronium.event()
print(f"Running event: {event_data.get('name')} (ID: {event_data.get('id')})")

# Set output
cronium.output({"result": "success", "processed": True})`,
    nodejs: `// cronium is automatically available - no imports needed!

// Access input
const userData = cronium.input();
console.log(\`Processing for user: \${userData.name || 'unknown'}\`);

// Access event metadata
const eventData = cronium.event();
console.log(\`Running event: \${eventData.name} (ID: \${eventData.id})\`);

// Set output
cronium.output({result: "success", processed: true});`,
    curl: `# cronium functions are automatically available - no sourcing needed!

# Access input
input_data=$(cronium_input)
user_name=$(echo "$input_data" | jq -r '.name // "unknown"')
echo "Processing for user: $user_name"

# Access event metadata
event_data=$(cronium_event)
event_name=$(echo "$event_data" | jq -r '.name')
event_id=$(echo "$event_data" | jq -r '.id')
echo "Running event: $event_name (ID: $event_id)"

# Set output
cronium_output '{"result": "success", "processed": true}'`,
  },
};

export default async function UnifiedIOPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <DocsLayout lang={lang} tableOfContents={tableOfContents}>
      <ApiCodeExamples>
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <h1 className="mb-4 text-4xl font-bold">
              Unified Input/Output System
            </h1>
            <p className="text-muted-foreground text-xl">
              Enable seamless data exchange between events across Python,
              Node.js, and Bash scripts with standardized functions and API
              integration.
            </p>
          </div>

          <section id="overview" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Overview</h2>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Core Capabilities
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p>
                  The Unified Input/Output System provides a consistent way to
                  pass data between events and workflows, regardless of the
                  programming language. This enables powerful data processing
                  pipelines and external system integration.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-lg border p-4">
                    <h4 className="mb-2 font-semibold">
                      Cross-Language Support
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      Works consistently across Python, Node.js, and Bash
                      scripts
                    </p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <h4 className="mb-2 font-semibold">API Integration</h4>
                    <p className="text-muted-foreground text-sm">
                      Accept input data via REST API endpoints for external
                      integrations
                    </p>
                  </div>
                  <div className="rounded-lg border p-4">
                    <h4 className="mb-2 font-semibold">Workflow Chaining</h4>
                    <p className="text-muted-foreground text-sm">
                      Automatic data flow between connected workflow nodes
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="cronium-input" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Using cronium.input()</h2>
            <p className="text-muted-foreground mb-6">
              The <code>cronium</code> object is automatically injected into
              every script. No imports, requires, or sourcing needed - just
              start using <code>cronium.input()</code> and{" "}
              <code>cronium.output()</code> immediately.
            </p>

            <CodeBlock
              examples={runtimeExamples.croniumInput}
              title="Accessing Input Data"
            />

            <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
              <h4 className="mb-2 font-semibold text-blue-800 dark:text-blue-200">
                Automatic Injection
              </h4>
              <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                <li>
                  • <strong>Python:</strong> <code>cronium</code> object
                  available globally
                </li>
                <li>
                  • <strong>Node.js:</strong> <code>cronium</code> object
                  available globally
                </li>
                <li>
                  • <strong>Bash:</strong> <code>cronium_input()</code> and{" "}
                  <code>cronium_output()</code> functions available
                </li>
                <li>• Automatic JSON parsing and error handling</li>
                <li>• Returns empty object if no input provided</li>
              </ul>
            </div>
          </section>

          <section id="cronium-output" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Using cronium.output()</h2>
            <p className="text-muted-foreground mb-6">
              Set output data using the simple <code>cronium.output()</code>{" "}
              function. This data can be accessed by subsequent workflow nodes
              or retrieved via API. The cronium object is automatically
              available in all scripts.
            </p>

            <CodeBlock
              examples={runtimeExamples.croniumOutput}
              title="Setting Output Data"
            />

            <Separator className="my-8" />

            <div className="mb-8">
              <h3 className="mb-4 flex items-center gap-2 text-xl font-semibold">
                <Code2 className="h-5 w-5 text-green-600" />
                Standard Logging
              </h3>
              <p className="text-muted-foreground mb-4">
                Use standard logging methods in each language. The cronium
                object is automatically available if you need to access input
                data within your logging.
              </p>

              <CodeBlock
                examples={runtimeExamples.logging}
                title="Logging Examples"
              />
            </div>
          </section>

          <section id="cronium-event" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Using cronium.event()</h2>
            <p className="text-muted-foreground mb-6">
              Access event metadata using the <code>cronium.event()</code>{" "}
              function. This returns information about the current event such as
              its ID, name, type, server details, and execution statistics.
            </p>

            <CodeBlock
              examples={runtimeExamples.croniumEvent}
              title="Accessing Event Metadata"
            />

            <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
              <h4 className="mb-2 font-semibold text-blue-800 dark:text-blue-200">
                Available Event Data
              </h4>
              <ul className="space-y-1 text-sm text-blue-700 dark:text-blue-300">
                <li>
                  • <strong>id:</strong> Unique event identifier
                </li>
                <li>
                  • <strong>name:</strong> Event display name
                </li>
                <li>
                  • <strong>description:</strong> Event description
                </li>
                <li>
                  • <strong>type:</strong> Script type (PYTHON, NODEJS, BASH)
                </li>
                <li>
                  • <strong>runLocation:</strong> Execution location (LOCAL,
                  REMOTE)
                </li>
                <li>
                  • <strong>server:</strong> Server details (if running
                  remotely)
                </li>
                <li>
                  • <strong>successCount/failureCount:</strong> Execution
                  statistics
                </li>
                <li>
                  • <strong>createdAt/updatedAt:</strong> Timestamps
                </li>
              </ul>
            </div>
          </section>

          <section id="api-integration" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">API Integration</h2>
            <Card>
              <CardHeader>
                <CardTitle>Passing Input via API</CardTitle>
                <CardDescription>
                  Execute events with custom input data using the REST API
                  endpoint
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h4 className="mb-3 font-semibold">HTTP Request Format</h4>
                  <SimpleCodeBlock language="http">{`POST /api/events/{event_id}/execute
Content-Type: application/json
Authorization: Bearer YOUR_API_TOKEN

{
  "input": {
    "user_id": 123,
    "action": "process_data",
    "data": {
      "items": ["item1", "item2", "item3"],
      "priority": "high"
    },
    "metadata": {
      "request_id": "req_12345",
      "timestamp": "2025-06-06T22:00:00Z"
    }
  }
}`}</SimpleCodeBlock>
                </div>

                <div>
                  <h4 className="mb-3 font-semibold">Example API Calls</h4>
                  <CodeBlock
                    examples={runtimeExamples.apiIntegration}
                    title="API Integration Examples"
                  />
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="quick-reference" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Quick Reference</h2>
            <Card>
              <CardContent className="pt-6">
                <CodeBlock
                  examples={runtimeExamples.quickReference}
                  title="Quick Start Examples"
                />
              </CardContent>
            </Card>
          </section>

          <section id="best-practices" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Best Practices</h2>
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-2 font-semibold">
                      Data Structure Guidelines
                    </h4>
                    <ul className="text-muted-foreground list-disc space-y-1 pl-6">
                      <li>
                        Use JSON-compatible data types (objects, arrays,
                        strings, numbers, booleans)
                      </li>
                      <li>
                        Include meaningful field names and consistent structure
                      </li>
                      <li>
                        Add metadata like timestamps and request IDs for
                        traceability
                      </li>
                      <li>Validate input data before processing</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">Error Handling</h4>
                    <ul className="text-muted-foreground list-disc space-y-1 pl-6">
                      <li>
                        Always check if input data exists before accessing
                        fields
                      </li>
                      <li>Provide default values for optional fields</li>
                      <li>
                        Include error information in output when processing
                        fails
                      </li>
                      <li>
                        Use try-catch blocks to handle exceptions gracefully
                      </li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">
                      Performance Considerations
                    </h4>
                    <ul className="text-muted-foreground list-disc space-y-1 pl-6">
                      <li>
                        Keep input/output data reasonably sized (&lt; 1MB
                        recommended)
                      </li>
                      <li>Avoid deeply nested objects when possible</li>
                      <li>Use efficient data processing algorithms</li>
                      <li>Clean up temporary data when no longer needed</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          <section id="troubleshooting" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Troubleshooting</h2>
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-6">
                  <div>
                    <h4 className="mb-3 font-semibold">Common Issues</h4>
                    <div className="space-y-4">
                      <div className="border-l-4 border-red-500 bg-red-50 p-4 dark:bg-red-950">
                        <h5 className="font-medium text-red-800 dark:text-red-200">
                          Runtime helper not found
                        </h5>
                        <p className="mt-1 text-sm text-red-700 dark:text-red-300">
                          Ensure the import path is correct:{" "}
                          <code>/tmp/runtime-helpers/cronium.py</code>
                        </p>
                      </div>

                      <div className="border-l-4 border-yellow-500 bg-yellow-50 p-4 dark:bg-yellow-950">
                        <h5 className="font-medium text-yellow-800 dark:text-yellow-200">
                          cronium.input is empty
                        </h5>
                        <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
                          Check if input is being passed via API or if workflow
                          connections are properly configured.
                        </p>
                      </div>

                      <div className="border-l-4 border-blue-500 bg-blue-50 p-4 dark:bg-blue-950">
                        <h5 className="font-medium text-blue-800 dark:text-blue-200">
                          JSON output errors
                        </h5>
                        <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                          Validate JSON structure before calling
                          cronium.output(). Use JSON validators or linters.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-3 font-semibold">Debugging Tips</h4>
                    <ul className="text-muted-foreground list-disc space-y-1 pl-6">
                      <li>
                        Use standard logging (print, console.log, echo) to
                        output debug information
                      </li>
                      <li>
                        Check execution logs for runtime errors and output
                      </li>
                      <li>
                        Print <code>cronium.input</code> to verify data
                        structure
                      </li>
                      <li>
                        Test scripts individually before adding to workflows
                      </li>
                      <li>Use proper error handling with try-catch blocks</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </div>
      </ApiCodeExamples>
    </DocsLayout>
  );
}
