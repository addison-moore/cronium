import React from "react";
import DocsLayout from "@/components/docs/docs-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@cronium/ui";
import { Database, ArrowRight, Settings, FlaskConical } from "lucide-react";
import ApiCodeExamples, {
  CodeBlock,
} from "@/components/docs/api-code-examples";

const tableOfContents = [
  { title: "Overview", href: "#overview", level: 2 },
  { title: "Input & Output", href: "#input-output", level: 2 },
  { title: "Variables", href: "#variables", level: 2 },
  { title: "Conditions", href: "#conditions", level: 2 },
  { title: "Event Metadata", href: "#event-metadata", level: 2 },
  { title: "Complete Examples", href: "#complete-examples", level: 2 },
  { title: "Best Practices", href: "#best-practices", level: 2 },
];

// Code examples with language switching
const runtimeExamples = {
  input: {
    python: `# cronium is automatically available - no imports needed!

# Access input data
input_data = cronium.input()
print(f"Received: {input_data}")

# Access specific fields with defaults
user_id = input_data.get('user_id', 'unknown')
message = input_data.get('message', 'Hello World')
config = input_data.get('config', {})

# Use input in processing
if message:
    print(f"Processing message: {message}")`,
    nodejs: `// cronium is automatically available - no imports needed!

// Access input data
const inputData = cronium.input();
console.log('Received:', inputData);

// Access specific fields with defaults
const userId = inputData.user_id || 'unknown';
const message = inputData.message || 'Hello World';
const config = inputData.config || {};

// Use input in processing
if (message) {
    console.log(\`Processing message: \${message}\`);
}`,
    curl: `# cronium functions are automatically available - no sourcing needed!

# Access input data
input_data=$(cronium_input)
echo "Received: $input_data"

# Parse specific fields
user_id=$(echo "$input_data" | jq -r '.user_id // "unknown"')
message=$(echo "$input_data" | jq -r '.message // "Hello World"')

# Use input in processing
if [[ "$message" != "null" && "$message" != "" ]]; then
    echo "Processing message: $message"
fi`,
  },
  output: {
    python: `# cronium is automatically available - no imports needed!

# Create structured output
result = {
    "success": True,
    "message": "Data processed successfully",
    "data": {
        "processed_items": 42,
        "total_time": "2.5s",
        "errors": []
    },
    "next_action": "send_notification"
}

# Set output for next workflow node
cronium.output(result)

# The output will be available as input to the next connected node`,
    nodejs: `// cronium is automatically available - no imports needed!

// Create structured output
const result = {
    success: true,
    message: "Data processed successfully",
    data: {
        processedItems: 42,
        totalTime: "2.5s",
        errors: []
    },
    nextAction: "send_notification"
};

// Set output for next workflow node
cronium.output(result);

// The output will be available as input to the next connected node`,
    curl: `# cronium functions are automatically available - no sourcing needed!

# Create structured output (JSON)
result='{
    "success": true,
    "message": "Data processed successfully",
    "data": {
        "processed_items": 42,
        "total_time": "2.5s",
        "errors": []
    },
    "next_action": "send_notification"
}'

# Set output for next workflow node
cronium_output "$result"

# The output will be available as input to the next connected node`,
  },
  variables: {
    python: `# cronium is automatically available - no imports needed!

# Get a stored variable
example_api_key = cronium.getVariable('EXAMPLE_API_KEY')
database_url = cronium.getVariable('DATABASE_URL')

# Use variables with defaults
redis_host = cronium.getVariable('REDIS_HOST') or 'localhost'

# Set/update variables
cronium.setVariable('LAST_PROCESSED', '2025-06-17T10:30:00Z')
cronium.setVariable('COUNTER', str(int(cronium.getVariable('COUNTER') or '0') + 1))

# Variables persist across all script executions for the user
print(f"Processing count: {cronium.getVariable('COUNTER')}")`,
    nodejs: `// cronium is automatically available - no imports needed!

// Get a stored variable
const exampleApiKey = cronium.getVariable('EXAMPLE_API_KEY');
const databaseUrl = cronium.getVariable('DATABASE_URL');

// Use variables with defaults
const redisHost = cronium.getVariable('REDIS_HOST') || 'localhost';

// Set/update variables
cronium.setVariable('LAST_PROCESSED', '2025-06-17T10:30:00Z');
cronium.setVariable('COUNTER', String(parseInt(cronium.getVariable('COUNTER') || '0') + 1));

// Variables persist across all script executions for the user
console.log(\`Processing count: \${cronium.getVariable('COUNTER')}\`);`,
    curl: `# cronium functions are automatically available - no sourcing needed!

# Get a stored variable
example_api_key=$(cronium_getVariable "EXAMPLE_API_KEY")
database_url=$(cronium_getVariable "DATABASE_URL")

# Use variables with defaults
redis_host=$(cronium_getVariable "REDIS_HOST")
if [[ -z "$redis_host" ]]; then
    redis_host="localhost"
fi

# Set/update variables
cronium_setVariable "LAST_PROCESSED" "2025-06-17T10:30:00Z"

# Increment counter
counter=$(cronium_getVariable "COUNTER")
counter=\${counter:-0}
new_counter=$((counter + 1))
cronium_setVariable "COUNTER" "$new_counter"

# Variables persist across all script executions for the user
echo "Processing count: $(cronium_getVariable 'COUNTER')"`,
  },
  conditions: {
    python: `# cronium is automatically available - no imports needed!

# Process some data
input_data = cronium.input()
threshold = input_data.get('threshold', 100)
current_value = process_data()

# Set condition based on processing result
if current_value > threshold:
    print(f"Value {current_value} exceeds threshold {threshold}")
    cronium.setCondition(True)  # Trigger "On Condition" connections
else:
    print(f"Value {current_value} is within threshold")
    cronium.setCondition(False)  # Don't trigger "On Condition" connections

# Check existing condition (useful for complex logic)
existing_condition = cronium.getCondition()
if existing_condition:
    print("Condition was previously set to True")`,
    nodejs: `// cronium is automatically available - no imports needed!

// Process some data
const inputData = cronium.input();
const threshold = inputData.threshold || 100;
const currentValue = processData();

// Set condition based on processing result
if (currentValue > threshold) {
    console.log(\`Value \${currentValue} exceeds threshold \${threshold}\`);
    cronium.setCondition(true);  // Trigger "On Condition" connections
} else {
    console.log(\`Value \${currentValue} is within threshold\`);
    cronium.setCondition(false);  // Don't trigger "On Condition" connections
}

// Check existing condition (useful for complex logic)
const existingCondition = cronium.getCondition();
if (existingCondition) {
    console.log("Condition was previously set to true");
}`,
    curl: `# cronium functions are automatically available - no sourcing needed!

# Process some data
input_data=$(cronium_input)
threshold=$(echo "$input_data" | jq -r '.threshold // 100')
current_value=$(process_data)

# Set condition based on processing result
if (( current_value > threshold )); then
    echo "Value $current_value exceeds threshold $threshold"
    cronium_setCondition true  # Trigger "On Condition" connections
else
    echo "Value $current_value is within threshold"
    cronium_setCondition false  # Don't trigger "On Condition" connections
fi

# Check existing condition (useful for complex logic)
existing_condition=$(cronium_getCondition)
if [[ "$existing_condition" == "true" ]]; then
    echo "Condition was previously set to true"
fi`,
  },
  eventMetadata: {
    python: `# cronium is automatically available - no imports needed!

# Access event metadata
event = cronium.event()

print(f"Event ID: {event.get('id')}")
print(f"Event Name: {event.get('name')}")
print(f"Script Type: {event.get('type')}")
print(f"Run Location: {event.get('runLocation')}")

# Check execution statistics
print(f"Success Count: {event.get('successCount', 0)}")
print(f"Failure Count: {event.get('failureCount', 0)}")

# Server information (for remote execution)
server = event.get('server')
if server:
    print(f"Running on server: {server.get('name')} ({server.get('address')})")
else:
    print("Running locally")

# Use metadata for conditional logic
if event.get('type') == 'PYTHON':
    import json
    print("Running in Python environment")`,
    nodejs: `// cronium is automatically available - no imports needed!

// Access event metadata
const event = cronium.event();

console.log('Event ID:', event.id);
console.log('Event Name:', event.name);
console.log('Script Type:', event.type);
console.log('Run Location:', event.runLocation);

// Check execution statistics
console.log('Success Count:', event.successCount || 0);
console.log('Failure Count:', event.failureCount || 0);

// Server information (for remote execution)
const server = event.server;
if (server) {
    console.log(\`Running on server: \${server.name} (\${server.address})\`);
} else {
    console.log('Running locally');
}

// Use metadata for conditional logic
if (event.type === 'NODEJS') {
    console.log('Running in Node.js environment');
}`,
    curl: `# cronium functions are automatically available - no sourcing needed!

# Access event metadata
event_data=$(cronium_event)

event_id=$(echo "$event_data" | jq -r '.id')
event_name=$(echo "$event_data" | jq -r '.name')
script_type=$(echo "$event_data" | jq -r '.type')
run_location=$(echo "$event_data" | jq -r '.runLocation')

echo "Event ID: $event_id"
echo "Event Name: $event_name"
echo "Script Type: $script_type"
echo "Run Location: $run_location"

# Check execution statistics
success_count=$(echo "$event_data" | jq -r '.successCount // 0')
failure_count=$(echo "$event_data" | jq -r '.failureCount // 0')

echo "Success Count: $success_count"
echo "Failure Count: $failure_count"

# Server information (for remote execution)
server_name=$(echo "$event_data" | jq -r '.server.name // "local"')
server_address=$(echo "$event_data" | jq -r '.server.address // ""')

if [[ "$server_name" != "local" && "$server_name" != "null" ]]; then
    echo "Running on server: $server_name ($server_address)"
else
    echo "Running locally"
fi`,
  },
  completeExample: {
    python: `# cronium is automatically available - no imports needed!

# Complete workflow example
def main():
    # Get input data
    input_data = cronium.input()
    event = cronium.event()
    
    print(f"Processing event: {event.get('name')}")
    
    # Get configuration from variables
    max_retries = int(cronium.getVariable('MAX_RETRIES') or '3')
    api_endpoint = cronium.getVariable('API_ENDPOINT')
    
    # Process data
    items = input_data.get('items', [])
    processed_items = []
    errors = []
    
    for item in items:
        try:
            result = process_item(item, api_endpoint)
            processed_items.append(result)
        except Exception as e:
            errors.append(str(e))
    
    # Update processing stats
    total_processed = int(cronium.getVariable('TOTAL_PROCESSED') or '0')
    cronium.setVariable('TOTAL_PROCESSED', str(total_processed + len(processed_items)))
    
    # Set condition for workflow routing
    success_rate = len(processed_items) / len(items) if items else 1
    cronium.setCondition(success_rate > 0.8)  # 80% success threshold
    
    # Set output for next workflow node
    result = {
        "success": len(errors) == 0,
        "processed_count": len(processed_items),
        "error_count": len(errors),
        "success_rate": success_rate,
        "processed_items": processed_items,
        "errors": errors
    }
    cronium.output(result)
    
    print(f"Processed {len(processed_items)} items with {len(errors)} errors")

if __name__ == "__main__":
    main()`,
    nodejs: `// cronium is automatically available - no imports needed!

// Complete workflow example
async function main() {
    // Get input data
    const inputData = cronium.input();
    const event = cronium.event();
    
    console.log(\`Processing event: \${event.name}\`);
    
    // Get configuration from variables
    const maxRetries = parseInt(cronium.getVariable('MAX_RETRIES') || '3');
    const apiEndpoint = cronium.getVariable('API_ENDPOINT');
    
    // Process data
    const items = inputData.items || [];
    const processedItems = [];
    const errors = [];
    
    for (const item of items) {
        try {
            const result = await processItem(item, apiEndpoint);
            processedItems.push(result);
        } catch (error) {
            errors.push(error.message);
        }
    }
    
    // Update processing stats
    const totalProcessed = parseInt(cronium.getVariable('TOTAL_PROCESSED') || '0');
    cronium.setVariable('TOTAL_PROCESSED', String(totalProcessed + processedItems.length));
    
    // Set condition for workflow routing
    const successRate = items.length > 0 ? processedItems.length / items.length : 1;
    cronium.setCondition(successRate > 0.8);  // 80% success threshold
    
    // Set output for next workflow node
    const result = {
        success: errors.length === 0,
        processedCount: processedItems.length,
        errorCount: errors.length,
        successRate: successRate,
        processedItems: processedItems,
        errors: errors
    };
    cronium.output(result);
    
    console.log(\`Processed \${processedItems.length} items with \${errors.length} errors\`);
}

main().catch(console.error);`,
    curl: `#!/bin/bash
# cronium functions are automatically available - no sourcing needed!

# Complete workflow example
main() {
    # Get input data
    input_data=$(cronium_input)
    event_data=$(cronium_event)
    
    event_name=$(echo "$event_data" | jq -r '.name')
    echo "Processing event: $event_name"
    
    # Get configuration from variables
    max_retries=$(cronium_getVariable "MAX_RETRIES")
    max_retries=\${max_retries:-3}
    api_endpoint=$(cronium_getVariable "API_ENDPOINT")
    
    # Process data
    items=$(echo "$input_data" | jq -r '.items[]?')
    processed_count=0
    error_count=0
    
    # Process each item
    while IFS= read -r item; do
        if [[ -n "$item" && "$item" != "null" ]]; then
            if process_item "$item" "$api_endpoint"; then
                ((processed_count++))
            else
                ((error_count++))
            fi
        fi
    done <<< "$items"
    
    # Update processing stats
    total_processed=$(cronium_getVariable "TOTAL_PROCESSED")
    total_processed=\${total_processed:-0}
    new_total=$((total_processed + processed_count))
    cronium_setVariable "TOTAL_PROCESSED" "$new_total"
    
    # Calculate success rate
    total_items=$((processed_count + error_count))
    if [[ $total_items -gt 0 ]]; then
        success_rate=$(echo "scale=2; $processed_count / $total_items" | bc -l)
        # Set condition for workflow routing (80% success threshold)
        if (( $(echo "$success_rate > 0.8" | bc -l) )); then
            cronium_setCondition true
        else
            cronium_setCondition false
        fi
    else
        cronium_setCondition true
        success_rate=1.0
    fi
    
    # Set output for next workflow node
    result="{
        \\"success\\": $([ $error_count -eq 0 ] && echo true || echo false),
        \\"processed_count\\": $processed_count,
        \\"error_count\\": $error_count,
        \\"success_rate\\": $success_rate
    }"
    cronium_output "$result"
    
    echo "Processed $processed_count items with $error_count errors"
}

# Helper function
process_item() {
    local item="$1"
    local endpoint="$2"
    # Add your processing logic here
    return 0
}

main "$@"`,
  },
};

// Enable Partial Prerendering for this page
export const experimental_ppr = true;

// ISR configuration - revalidate every hour
export const revalidate = 3600; // 1 hour
export const dynamic = "force-static";
export default function RuntimeHelpersPage() {
  return (
    <DocsLayout tableOfContents={tableOfContents}>
      <ApiCodeExamples>
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <h1 className="mb-4 text-4xl font-bold">Cronium Runtime Helpers</h1>
            <p className="text-muted-foreground text-xl">
              Powerful runtime functions for data exchange, state management,
              and workflow control across Python, Node.js, and Bash scripts.
            </p>
          </div>

          <section id="overview" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Overview</h2>
            <Card className="bg-secondary-bg mb-6">
              <CardContent className="space-y-4">
                <p>
                  Cronium provides a consistent set of runtime helper functions
                  that are automatically available in all scripts. These
                  functions enable powerful workflow capabilities including data
                  exchange, persistent storage, conditional logic, and metadata
                  access.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="border-border bg-tertiary-bg rounded-lg border p-4">
                    <h4 className="mb-2 flex items-center gap-2 font-semibold">
                      <ArrowRight className="h-4 w-4" />
                      Data Flow
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      <code>cronium.input()</code> and{" "}
                      <code>cronium.output()</code> for seamless data exchange
                      between workflow nodes
                    </p>
                  </div>
                  <div className="border-border bg-tertiary-bg rounded-lg border p-4">
                    <h4 className="mb-2 flex items-center gap-2 font-semibold">
                      <Database className="h-4 w-4" />
                      State Management
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      <code>cronium.getVariable()</code> and{" "}
                      <code>cronium.setVariable()</code> for persistent user
                      data storage
                    </p>
                  </div>
                  <div className="border-border bg-tertiary-bg rounded-lg border p-4">
                    <h4 className="mb-2 flex items-center gap-2 font-semibold">
                      <FlaskConical className="h-4 w-4" />
                      Conditional Logic
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      <code>cronium.setCondition()</code> and{" "}
                      <code>cronium.getCondition()</code> for workflow routing
                      control
                    </p>
                  </div>
                  <div className="border-border bg-tertiary-bg rounded-lg border p-4">
                    <h4 className="mb-2 flex items-center gap-2 font-semibold">
                      <Settings className="h-4 w-4" />
                      Event Metadata
                    </h4>
                    <p className="text-muted-foreground text-sm">
                      <code>cronium.event()</code> for accessing event
                      information, execution stats, and server details
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
              <h4 className="mb-2 font-semibold text-blue-800 dark:text-blue-200">
                Automatic Availability
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
                  • <strong>Bash:</strong> Helper functions like{" "}
                  <code>cronium_input()</code> available
                </li>
                <li>• No imports, requires, or sourcing needed</li>
                <li>• Works in both local and remote execution environments</li>
              </ul>
            </div>
          </section>

          <section id="input-output" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Input & Output</h2>
            <p className="text-muted-foreground mb-6">
              Exchange data between workflow nodes and external systems using{" "}
              <code>cronium.input()</code> and <code>cronium.output()</code>.
              Input data can come from API calls, previous workflow nodes, or
              manual triggers.
            </p>

            <div className="mb-8">
              <h3 className="mb-4 text-xl font-semibold">Reading Input Data</h3>
              <CodeBlock
                examples={runtimeExamples.input}
                title="cronium.input()"
              />
            </div>

            <div className="mb-8">
              <h3 className="mb-4 text-xl font-semibold">
                Setting Output Data
              </h3>
              <CodeBlock
                examples={runtimeExamples.output}
                title="cronium.output()"
              />
            </div>

            <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
              <h4 className="mb-2 font-semibold text-green-800 dark:text-green-200">
                Data Flow
              </h4>
              <ul className="space-y-1 text-sm text-green-700 dark:text-green-300">
                <li>
                  • Input from API: Include <code>"input": {"{...}"}</code> in
                  request body
                </li>
                <li>
                  • Input from workflows: Automatic from previous node's output
                </li>
                <li>• Output becomes input for connected workflow nodes</li>
                <li>• JSON format ensures cross-language compatibility</li>
              </ul>
            </div>
          </section>

          <section id="variables" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Variables</h2>
            <p className="text-muted-foreground mb-6">
              Store and retrieve persistent data across script executions using{" "}
              <code>cronium.getVariable()</code> and{" "}
              <code>cronium.setVariable()</code>. Variables are scoped per user
              and persist across all events and workflows.
            </p>

            <CodeBlock
              examples={runtimeExamples.variables}
              title="Persistent Variables"
            />

            <div className="mt-6 rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-950">
              <h4 className="mb-2 font-semibold text-purple-800 dark:text-purple-200">
                Variable Features
              </h4>
              <ul className="space-y-1 text-sm text-purple-700 dark:text-purple-300">
                <li>
                  • <strong>User-scoped:</strong> Each user has their own
                  variable namespace
                </li>
                <li>
                  • <strong>Persistent:</strong> Values survive server restarts
                  and deployments
                </li>
                <li>
                  • <strong>String storage:</strong> All values stored as
                  strings (convert as needed)
                </li>
                <li>
                  • <strong>Cross-language:</strong> Variables set in Python can
                  be read in Node.js or Bash
                </li>
                <li>
                  • <strong>Use cases:</strong> API keys, counters, last run
                  timestamps, configuration
                </li>
              </ul>
            </div>
          </section>

          <section id="conditions" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Conditions</h2>
            <p className="text-muted-foreground mb-6">
              Control workflow routing using <code>cronium.setCondition()</code>{" "}
              and <code>cronium.getCondition()</code>. Set boolean conditions to
              determine which workflow paths are executed based on runtime
              logic.
            </p>

            <CodeBlock
              examples={runtimeExamples.conditions}
              title="Conditional Workflow Routing"
            />

            <div className="mt-6 rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950">
              <h4 className="mb-2 font-semibold text-orange-800 dark:text-orange-200">
                Workflow Connections
              </h4>
              <ul className="space-y-1 text-sm text-orange-700 dark:text-orange-300">
                <li>
                  • <strong>Always:</strong> Connection always executes
                  (default)
                </li>
                <li>
                  • <strong>On Success:</strong> Executes only if script
                  succeeded
                </li>
                <li>
                  • <strong>On Failure:</strong> Executes only if script failed
                </li>
                <li>
                  • <strong>On Condition:</strong> Executes only if{" "}
                  <code>cronium.setCondition(true)</code> was called
                </li>
              </ul>
            </div>
          </section>

          <section id="event-metadata" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Event Metadata</h2>
            <p className="text-muted-foreground mb-6">
              Access comprehensive information about the current event execution
              using <code>cronium.event()</code>. This includes event details,
              execution statistics, and server information.
            </p>

            <CodeBlock
              examples={runtimeExamples.eventMetadata}
              title="Event Information"
            />

            <div className="mt-6 rounded-lg border border-cyan-200 bg-cyan-50 p-4 dark:border-cyan-800 dark:bg-cyan-950">
              <h4 className="mb-2 font-semibold text-cyan-800 dark:text-cyan-200">
                Available Metadata
              </h4>
              <ul className="space-y-1 text-sm text-cyan-700 dark:text-cyan-300">
                <li>
                  • <strong>id:</strong> Unique event identifier
                </li>
                <li>
                  • <strong>name:</strong> Event display name
                </li>
                <li>
                  • <strong>type:</strong> Script type (PYTHON, NODEJS, BASH,
                  HTTP_REQUEST)
                </li>
                <li>
                  • <strong>runLocation:</strong> LOCAL or REMOTE execution
                </li>
                <li>
                  • <strong>successCount/failureCount:</strong> Execution
                  statistics
                </li>
                <li>
                  • <strong>server:</strong> Server details for remote execution
                </li>
                <li>
                  • <strong>lastRunAt:</strong> Timestamp of last execution
                </li>
              </ul>
            </div>
          </section>

          <section id="complete-examples" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Complete Examples</h2>
            <p className="text-muted-foreground mb-6">
              Comprehensive examples demonstrating how to combine all runtime
              helpers for powerful workflow automation.
            </p>

            <CodeBlock
              examples={runtimeExamples.completeExample}
              title="Full Workflow Script"
            />
          </section>

          <section id="best-practices" className="mb-12">
            <h2 className="mb-4 text-2xl font-bold">Best Practices</h2>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Data Handling</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <h5 className="mb-1 font-semibold">Input Validation</h5>
                    <p className="text-muted-foreground text-sm">
                      Always provide defaults when accessing input fields to
                      handle missing data gracefully.
                    </p>
                  </div>
                  <div>
                    <h5 className="mb-1 font-semibold">Structured Output</h5>
                    <p className="text-muted-foreground text-sm">
                      Use consistent JSON structures with success flags, data,
                      and error information.
                    </p>
                  </div>
                  <div>
                    <h5 className="mb-1 font-semibold">Error Handling</h5>
                    <p className="text-muted-foreground text-sm">
                      Include error details in output for debugging and
                      monitoring purposes.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Variables & State</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <h5 className="mb-1 font-semibold">Naming Convention</h5>
                    <p className="text-muted-foreground text-sm">
                      Use UPPERCASE for configuration variables, lowercase for
                      runtime state.
                    </p>
                  </div>
                  <div>
                    <h5 className="mb-1 font-semibold">Type Conversion</h5>
                    <p className="text-muted-foreground text-sm">
                      Remember variables are stored as strings - convert to
                      needed types when reading.
                    </p>
                  </div>
                  <div>
                    <h5 className="mb-1 font-semibold">Default Values</h5>
                    <p className="text-muted-foreground text-sm">
                      Always provide fallback values when reading variables that
                      might not exist.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Workflow Design</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <h5 className="mb-1 font-semibold">Condition Logic</h5>
                    <p className="text-muted-foreground text-sm">
                      Use meaningful conditions that reflect business logic, not
                      just technical success/failure.
                    </p>
                  </div>
                  <div>
                    <h5 className="mb-1 font-semibold">
                      Single Responsibility
                    </h5>
                    <p className="text-muted-foreground text-sm">
                      Keep each event focused on one task, use output to pass
                      data to specialized nodes.
                    </p>
                  </div>
                  <div>
                    <h5 className="mb-1 font-semibold">Logging</h5>
                    <p className="text-muted-foreground text-sm">
                      Use standard logging methods while leveraging cronium
                      functions for data flow.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Performance</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <h5 className="mb-1 font-semibold">Minimize Variables</h5>
                    <p className="text-muted-foreground text-sm">
                      Don't overuse variables for temporary data - use output
                      for workflow data passing.
                    </p>
                  </div>
                  <div>
                    <h5 className="mb-1 font-semibold">Conditional Checks</h5>
                    <p className="text-muted-foreground text-sm">
                      Use getCondition() to build complex logic without
                      unnecessary processing.
                    </p>
                  </div>
                  <div>
                    <h5 className="mb-1 font-semibold">Event Metadata</h5>
                    <p className="text-muted-foreground text-sm">
                      Cache event() calls if you need to access metadata
                      multiple times in a script.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </section>
        </div>
      </ApiCodeExamples>
    </DocsLayout>
  );
}
