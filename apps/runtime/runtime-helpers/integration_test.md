# Runtime SDK Integration Tests

This document provides integration test scenarios that can be used to verify all three SDKs (Python, Node.js, Bash) work correctly with the Runtime API service.

## Test Environment Setup

1. Start the Runtime API service:

```bash
cd runtime/cronium-runtime
go run cmd/runtime/main.go
```

2. Start a Valkey/Redis instance:

```bash
docker run -d -p 6379:6379 --name valkey valkey/valkey:7-alpine
```

3. Set test environment variables:

```bash
export CRONIUM_RUNTIME_API="http://localhost:8081"
export CRONIUM_EXECUTION_TOKEN="test-token-123"
export CRONIUM_EXECUTION_ID="test-exec-123"
export RUNTIME_JWT_SECRET="test-secret"
export RUNTIME_BACKEND_TOKEN="backend-token"
```

## Test Scenarios

### 1. Basic Input/Output Test

**Python:**

```python
import cronium

# Get input
data = cronium.input()
print(f"Input: {data}")

# Process and output
result = {"processed": True, "count": len(data) if data else 0}
cronium.output(result)
```

**Node.js:**

```javascript
const cronium = require("cronium");

async function test() {
  // Get input
  const data = await cronium.input();
  console.log("Input:", data);

  // Process and output
  const result = { processed: true, count: data ? data.length : 0 };
  await cronium.output(result);
}

test().catch(console.error);
```

**Bash:**

```bash
#!/bin/bash
source /usr/local/bin/cronium.sh

# Get input
input=$(cronium_input)
echo "Input: $input"

# Process and output
count=$(echo "$input" | jq 'length // 0')
cronium_output "{\"processed\": true, \"count\": $count}"
```

### 2. Variable Management Test

**Python:**

```python
import cronium
from datetime import datetime

# Set variables
cronium.set_variable("counter", 1)
cronium.set_variable("last_run", datetime.now().isoformat())
cronium.set_variable("config", {"mode": "test", "debug": True})

# Get variables
counter = cronium.get_variable("counter")
last_run = cronium.get_variable("last_run")
config = cronium.get_variable("config")

print(f"Counter: {counter}, Last Run: {last_run}, Config: {config}")

# Update counter
cronium.set_variable("counter", counter + 1)
```

**Node.js:**

```javascript
const cronium = require("cronium");

async function test() {
  // Set variables
  await cronium.setVariable("counter", 1);
  await cronium.setVariable("last_run", new Date().toISOString());
  await cronium.setVariable("config", { mode: "test", debug: true });

  // Get variables
  const counter = await cronium.getVariable("counter");
  const lastRun = await cronium.getVariable("last_run");
  const config = await cronium.getVariable("config");

  console.log(`Counter: ${counter}, Last Run: ${lastRun}, Config:`, config);

  // Update counter
  await cronium.setVariable("counter", counter + 1);
}

test().catch(console.error);
```

**Bash:**

```bash
#!/bin/bash
source /usr/local/bin/cronium.sh

# Set variables
cronium_set_variable "counter" "1"
cronium_set_variable "last_run" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cronium_set_variable "config" '{"mode": "test", "debug": true}'

# Get variables
counter=$(cronium_get_variable "counter")
last_run=$(cronium_get_variable "last_run")
config=$(cronium_get_variable "config")

echo "Counter: $counter, Last Run: $last_run, Config: $config"

# Update counter
cronium_increment_variable "counter"
```

### 3. Workflow Condition Test

**Python:**

```python
import cronium

# Process data
data = cronium.input()
items_processed = 0

if data and isinstance(data, list):
    for item in data:
        # Process item
        items_processed += 1

# Set condition based on results
cronium.set_condition(items_processed > 0)
cronium.output({"items_processed": items_processed})
```

**Node.js:**

```javascript
const cronium = require("cronium");

async function test() {
  // Process data
  const data = await cronium.input();
  let itemsProcessed = 0;

  if (Array.isArray(data)) {
    for (const item of data) {
      // Process item
      itemsProcessed++;
    }
  }

  // Set condition based on results
  await cronium.setCondition(itemsProcessed > 0);
  await cronium.output({ itemsProcessed });
}

test().catch(console.error);
```

**Bash:**

```bash
#!/bin/bash
source /usr/local/bin/cronium.sh

# Process data
input=$(cronium_input)
items_processed=0

if [ -n "$input" ]; then
    items_processed=$(echo "$input" | jq 'length // 0')
fi

# Set condition based on results
if [ "$items_processed" -gt 0 ]; then
    cronium_set_condition true
else
    cronium_set_condition false
fi

cronium_output "{\"items_processed\": $items_processed}"
```

### 4. Event Context Test

**Python:**

```python
import cronium

# Get event context
event = cronium.event()
print(f"Event ID: {event.get('id')}")
print(f"Event Name: {event.get('name')}")
print(f"Event Type: {event.get('type')}")
print(f"User ID: {event.get('userId')}")
```

**Node.js:**

```javascript
const cronium = require("cronium");

async function test() {
  // Get event context
  const event = await cronium.event();
  console.log(`Event ID: ${event.id}`);
  console.log(`Event Name: ${event.name}`);
  console.log(`Event Type: ${event.type}`);
  console.log(`User ID: ${event.userId}`);
}

test().catch(console.error);
```

**Bash:**

```bash
#!/bin/bash
source /usr/local/bin/cronium.sh

# Get event context
event=$(cronium_event)
echo "Full event: $event"

# Get specific fields
event_id=$(cronium_event_field "id")
event_name=$(cronium_event_field "name")
event_type=$(cronium_event_field "type")
user_id=$(cronium_event_field "userId")

echo "Event ID: $event_id"
echo "Event Name: $event_name"
echo "Event Type: $event_type"
echo "User ID: $user_id"
```

### 5. Error Handling Test

**Python:**

```python
import cronium
from cronium import CroniumError, CroniumAPIError

try:
    # Try to get a non-existent variable
    value = cronium.get_variable("non_existent_var")
    if value is None:
        print("Variable not found")

    # Try invalid operation
    cronium.output("This should be valid")

except CroniumAPIError as e:
    print(f"API Error: {e.status_code} - {e.message}")
except CroniumError as e:
    print(f"Cronium Error: {e}")
except Exception as e:
    print(f"Unexpected error: {e}")
```

**Node.js:**

```javascript
const { CroniumAPIError, CroniumError } = require("cronium");
const cronium = require("cronium");

async function test() {
  try {
    // Try to get a non-existent variable
    const value = await cronium.getVariable("non_existent_var");
    if (value === null) {
      console.log("Variable not found");
    }

    // Try valid operation
    await cronium.output("This should be valid");
  } catch (error) {
    if (error instanceof CroniumAPIError) {
      console.log(`API Error: ${error.statusCode} - ${error.message}`);
    } else if (error instanceof CroniumError) {
      console.log(`Cronium Error: ${error.message}`);
    } else {
      console.log(`Unexpected error: ${error.message}`);
    }
  }
}

test();
```

**Bash:**

```bash
#!/bin/bash
source /usr/local/bin/cronium.sh

# Try to get a non-existent variable
value=$(cronium_get_variable "non_existent_var" 2>&1)
if [ $? -ne 0 ] || [ -z "$value" ]; then
    echo "Variable not found or error occurred"
fi

# Check if variable exists
if cronium_variable_exists "non_existent_var"; then
    echo "Variable exists"
else
    echo "Variable does not exist"
fi

# Try valid operation with error checking
if cronium_output "This should be valid"; then
    echo "Output set successfully"
else
    echo "Failed to set output"
fi
```

## Running the Tests

1. Save each test script with appropriate extension (.py, .js, .sh)
2. Ensure the Runtime API is running
3. Run each test:

```bash
# Python
python test_basic.py

# Node.js
node test_basic.js

# Bash
bash test_basic.sh
```

## Expected Results

All tests should complete without errors and demonstrate:

- Successful communication with the Runtime API
- Proper data serialization/deserialization
- Correct error handling
- Consistent behavior across all SDKs
