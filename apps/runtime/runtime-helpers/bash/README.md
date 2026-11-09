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
- `cronium_output [data]` - Set execution output data, from the argument or else from stdin. A single JSON value is sent as JSON, and anything else as a string, including numbers JSON doesn't allow, such as `010` or `+5`. See [Values from stdin](#values-from-stdin)
- `cronium_get_variable <key>` - Print the variable's bare value. If it has no value, print nothing and return 0. If it can't be read, return 1
- `cronium_set_variable <key> [value]` - Set a variable, from the argument or else from stdin. Variables are stored as strings, so `42` and `{"a":1}` read back as that text. A number reads back as it was written, so `010` stays `010` and `1e3` stays `1e3`
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

- `cronium_variable_exists <key>` - Return 0 if the variable has a value, 1 if it doesn't, and 2 if it can't be read. An `if` treats 2 like 1, so check `$?` where the difference matters
- `cronium_delete_variable <key>` - Not working yet: a variable cannot be deleted from a script, so this returns an error
- `cronium_increment_variable <key> [increment]` - Add to an integer variable and print the result. A variable with no value starts from 0. Both numbers count in decimal and may be negative, so a stored `010` plus 1 is `11`, which is what gets stored
- `cronium_append_variable <key> <value> [separator]` - Append to a string variable. A variable with no value starts empty
- `cronium_info` - Display SDK information

If `cronium_increment_variable` or `cronium_append_variable` can't read the variable, it writes nothing, so the stored value stays as it was. It prints why on stderr and returns 1. It also returns 1 if it can't store the result.

`cronium_increment_variable` does the same if the increment or the stored value isn't a 64-bit integer, or the result wouldn't fit in 64 bits. An integer is digits with an optional sign, so `1.5`, `1e3`, `0x10`, `1+1`, the name of a shell variable, an empty string and a number with spaces around it are all refused.

The functions behave the same under `set -u` and `set -e`. Under `set -e`, one that fails ends the script, as any other command does.

## Values from stdin

With no value argument, `cronium_output` and `cronium_set_variable` send all of stdin, in a container and on a remote server:

```bash
./build_report.sh | cronium_output
sort names.txt | cronium_set_variable "sorted_names"
```

- A single JSON value is sent as that value, whatever spaces or newlines are around it. Anything else is sent as a string with every byte in it, including the newline that `echo` ends with, so `echo x | cronium_output` sends `"x\n"`.
- An argument is always the value, even an empty one, and stdin is left alone. `cronium_output ""` sends an empty string whatever is piped in.
- With nothing piped in, a job's stdin is empty, so the call sends an empty string. For `cronium_set_variable` that replaces the stored value.
- It reads to the end of stdin, so a call with no argument inside `while read ...; do` takes the rest of what the loop was reading.
- If stdin can't be read, it sends nothing, says why on stderr and returns 1.

If you source the SDK in a shell of your own, a call with no argument doesn't wait at a terminal: it sends an empty string. It does wait for the end of anything else on stdin, such as a pipe that stays open.

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

Loading the SDK overwrites none of an event's env vars, so an event can use a name like `CRONIUM_TOKEN` for a REST API token. Names starting with `_cronium_` are the SDK's own.
