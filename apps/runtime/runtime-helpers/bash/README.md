# Cronium Bash SDK

Runtime SDK for bash scripts in Cronium, in a container or on a remote server.

## Installation

Nothing to install or load: the functions are already there when a script starts, in a container and on a remote server, and a `bash` the script starts inherits them. A remote server has no `/usr/local/bin/cronium.sh`, so a script that sources it runs in a container but fails on a remote server under `set -e`.

For local development:

```bash
source /path/to/cronium.sh
```

## Usage

```bash
#!/bin/bash

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
```

## Functions Reference

### Core Functions

- `cronium_input` - Get execution input data
- `cronium_output <data>` - Set execution output data
- `cronium_get_variable <key>` - Print the variable's bare value
- `cronium_set_variable <key> <value>` - Set a variable. Variables are stored as strings, so `42` and `{"a":1}` read back as that text
- `cronium_set_condition <true|false>` - Set workflow condition
- `cronium_event` - Get full event context as JSON
- `cronium_event_field <field>` - Get specific event field

### Tool Functions

- `cronium_execute_tool_action <tool> <action> <config_json>` - Execute any tool action. `<tool>` is the type of a saved tool connection and `<action>` is the action's ID, for example `cronium_execute_tool_action SQL run-query '{"query":"SELECT 1"}'`. It runs against the event owner's connection of that type, and the most recently created one if there are several.

These wrappers exist in a container and on a remote server, but **they currently fail in both**. They send a lowercase tool type, the action ID `send_message`, and parameter names that the email, Slack and Discord tools do not recognize. Use `cronium_execute_tool_action` until they are fixed.

- `cronium_send_email <to> <subject> <body> [options]` - Send email
  - Options: `--cc <emails>`, `--bcc <emails>`, `--html`
- `cronium_send_slack_message <channel> <text> [options]` - Send Slack message
  - Options: `--username <name>`, `--icon-emoji <emoji>`, `--icon-url <url>`
- `cronium_send_discord_message <channel_id> <content> [--embed <json>]` - Send Discord message

### Utility Functions

- `cronium_variable_exists <key>` - Check if variable exists
- `cronium_delete_variable <key>` - Not working yet: a variable cannot be deleted from a script, so this returns an error
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
else
    cronium_set_condition false
fi
```

## Requirements

In a container, everything is in the image. The SDK there needs:

- `bash` 4.0 or higher
- `curl` for HTTP requests
- `jq` for JSON parsing
- Environment variables, which Cronium sets:
  - `CRONIUM_EXECUTION_TOKEN` - Authentication token
  - `CRONIUM_EXECUTION_ID` - Execution ID
  - `CRONIUM_RUNTIME_API` - API URL (optional, defaults to http://localhost:8081)

A script still runs if `curl`, `jq` or one of these variables is missing. Each function except `cronium_info` checks when it's called, and if something is missing it prints why on stderr, makes no request and returns 1.

On a remote server, the functions need only `bash`, because they run on helper binaries that the runner brings with it. A script that calls `jq` itself, like the examples above, needs `jq` installed on that server.
