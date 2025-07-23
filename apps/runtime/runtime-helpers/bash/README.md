# Cronium Bash SDK

Runtime SDK for Cronium containerized script execution in Bash.

## Installation

The SDK is automatically available in Cronium containers at `/usr/local/bin/cronium.sh`.

For local development:

```bash
source /path/to/cronium.sh
```

## Usage

```bash
#!/bin/bash
source /usr/local/bin/cronium.sh

# Get input data
input=$(cronium_input)
echo "Received input: $input"

# Process the data
result=$(echo "$input" | jq '.items | length')

# Set output
cronium_output "{\"processed_count\": $result}"

# Work with variables
cronium_set_variable "last_run" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
last_run=$(cronium_get_variable "last_run")

# Set workflow condition
if [ "$result" -gt 0 ]; then
    cronium_set_condition true
else
    cronium_set_condition false
fi

# Send notifications
cronium_send_email "admin@example.com" "Task Complete" "Processed $result items"
```

## Functions Reference

### Core Functions

- `cronium_input` - Get execution input data
- `cronium_output <data>` - Set execution output data
- `cronium_get_variable <key>` - Get variable value
- `cronium_set_variable <key> <value>` - Set variable value
- `cronium_set_condition <true|false>` - Set workflow condition
- `cronium_event` - Get full event context as JSON
- `cronium_event_field <field>` - Get specific event field

### Tool Functions

- `cronium_execute_tool_action <tool> <action> <config_json>` - Execute any tool action
- `cronium_send_email <to> <subject> <body> [options]` - Send email
  - Options: `--cc <emails>`, `--bcc <emails>`, `--html`
- `cronium_send_slack_message <channel> <text> [options]` - Send Slack message
  - Options: `--username <name>`, `--icon-emoji <emoji>`, `--icon-url <url>`
- `cronium_send_discord_message <channel_id> <content> [--embed <json>]` - Send Discord message

### Utility Functions

- `cronium_variable_exists <key>` - Check if variable exists
- `cronium_delete_variable <key>` - Delete a variable (sets to null)
- `cronium_increment_variable <key> [increment]` - Increment numeric variable
- `cronium_append_variable <key> <value> [separator]` - Append to string variable
- `cronium_info` - Display SDK information

## Examples

### Working with JSON data

```bash
# Parse JSON input
items=$(cronium_input | jq -r '.items[]')

# Build JSON output
output=$(jq -n \
    --arg count "$count" \
    --arg status "success" \
    '{count: $count, status: $status}')
cronium_output "$output"
```

### Error handling

```bash
# Check if variable exists before using
if cronium_variable_exists "config"; then
    config=$(cronium_get_variable "config")
else
    echo "Error: config not set" >&2
    cronium_output '{"error": "Missing configuration"}'
    exit 1
fi
```

### Conditional workflows

```bash
# Process data and set condition
processed_count=$(process_data)

if [ "$processed_count" -gt 0 ]; then
    cronium_set_condition true
    cronium_send_slack_message "#notifications" "✅ Processed $processed_count items"
else
    cronium_set_condition false
    cronium_send_slack_message "#alerts" "⚠️ No items to process"
fi
```

## Requirements

- `bash` 4.0 or higher
- `curl` for HTTP requests
- `jq` for JSON parsing
- Environment variables:
  - `CRONIUM_EXECUTION_TOKEN` - Authentication token
  - `CRONIUM_EXECUTION_ID` - Execution ID
  - `CRONIUM_RUNTIME_API` - API URL (optional, defaults to http://localhost:8081)
