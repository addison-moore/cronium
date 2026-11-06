#!/bin/bash

# Cronium Runtime SDK for Bash
#
# This SDK provides runtime helper functions for bash scripts executing within the Cronium
# containerized environment. It communicates with the Runtime API service to manage
# variables, input/output data, and tool actions.
#
# Usage:
#   source /usr/local/bin/cronium.sh
#   
#   # Get input
#   input=$(cronium_input)
#   
#   # Set output
#   cronium_output "$result"
#   
#   # Work with variables
#   cronium_set_variable "key" "value"
#   value=$(cronium_get_variable "key")

# Configuration from environment. The functions below read these variables each
# time they run, so that they work in a bash this script starts. That bash inherits
# the functions (see `export -f` at the end of this file), but no plain shell
# variable set here.
export CRONIUM_RUNTIME_API="${CRONIUM_RUNTIME_API:-http://localhost:8081}"

# A script's variables belong to its event, so anything else this file assigns is named
# _cronium_*. A variable from the environment stays exported when assigned, so a plainer
# name would overwrite an event's value in the script and in everything the script runs.
#
# This copy of the token lets a script unset CRONIUM_EXECUTION_TOKEN to keep it from what
# it runs, and still call the functions itself. It must stay unexported, whatever the
# event defines: `env -u CRONIUM_EXECUTION_TOKEN tool` has to leave `tool` without the
# token.
export -n _cronium_token="${CRONIUM_EXECUTION_TOKEN:-}"

# Says why the helpers can't work here, if they can't. Each one calls this first. Nothing
# checks as this file loads, because it's sourced ahead of every job's script, where `exit`
# would end the job before its first line, and a script that calls no helper needs none of
# this. cronium_info doesn't call it, so that it can show what's missing.
_cronium_ready() {
    if [ -z "${CRONIUM_EXECUTION_TOKEN:-${_cronium_token:-}}" ]; then
        echo "Error: CRONIUM_EXECUTION_TOKEN environment variable not set" >&2
        return 1
    fi

    if [ -z "${CRONIUM_EXECUTION_ID:-}" ]; then
        echo "Error: CRONIUM_EXECUTION_ID environment variable not set" >&2
        return 1
    fi

    local cmd
    for cmd in curl jq; do
        if ! command -v "$cmd" &> /dev/null; then
            echo "Error: Required command '$cmd' not found" >&2
            return 1
        fi
    done
}

# Helper function to make API requests with retry logic
_cronium_request() {
    local method="$1"
    local path="$2"
    local data="$3"
    local max_retries=3
    local retry_delay=1
    local attempt=1
    local response
    local status_code
    local curl_exit
    local temp_file=$(mktemp)
    
    while [ $attempt -le $max_retries ]; do
        # Build curl command
        local curl_args=(
            -s
            -X "$method"
            -H "Authorization: Bearer ${CRONIUM_EXECUTION_TOKEN:-${_cronium_token:-}}"
            -H "Content-Type: application/json"
            -H "Accept: application/json"
            -w "\n%{http_code}"
            --max-time 30
            -o "$temp_file"
        )
        
        if [ -n "$data" ]; then
            curl_args+=(-d "$data")
        fi
        
        # Make request and capture status code. curl's exit status must be
        # propagated out of the substitution explicitly — the pipeline runs
        # in a subshell, so a bare `$?` afterwards only ever saw tail's
        # (always zero) exit status and network failures were never retried.
        status_code=$(curl "${curl_args[@]}" "${CRONIUM_RUNTIME_API}${path}" | tail -n1; exit "${PIPESTATUS[0]}")
        curl_exit=$?

        # Retry on network failures (connection refused/reset, timeout, DNS):
        # curl exits non-zero and/or reports an http_code of 000.
        if [ "$curl_exit" -ne 0 ] || [ "$status_code" = "000" ]; then
            if [ $attempt -lt $max_retries ]; then
                sleep $((retry_delay * attempt))
                ((attempt++))
                continue
            fi
            rm -f "$temp_file"
            # Include curl's exit code and the target: "after N attempts" alone
            # can't distinguish DNS failure (6) from connection refused (7) or
            # timeout (28), which are very different operator problems.
            echo "Error: Request failed after $max_retries attempts" \
                "(curl exit $curl_exit, http_code ${status_code:-none}," \
                "url ${CRONIUM_RUNTIME_API}${path})" >&2
            return 1
        fi
        
        # Read response
        response=$(cat "$temp_file")
        rm -f "$temp_file"
        
        # Check status code
        if [ "$status_code" -ge 200 ] && [ "$status_code" -lt 300 ]; then
            echo "$response"
            return 0
        elif [ "$status_code" -eq 404 ] && [ "$method" = "GET" ]; then
            # Special case for variable not found
            echo '{"data":{"value":null}}'
            return 0
        elif [ "$status_code" -ge 500 ] && [ "$status_code" -ne 501 ] && [ $attempt -lt $max_retries ]; then
            # Retry on server errors. 501 is excluded: it means the endpoint
            # is permanently unsupported in this execution context (e.g. tool
            # actions with no backing app route) — surface it immediately.
            sleep $((retry_delay * attempt))
            ((attempt++))
            continue
        else
            # Client error or final attempt
            # Runtime error bodies use {"error": "..."}; some proxies use
            # {"message": "..."}. Always include the status code so failures
            # are diagnosable from job logs.
            local error_msg=$(echo "$response" | jq -r '.message // .error // "Unknown error"' 2>/dev/null || echo "no body")
            echo "Error: API request failed - HTTP $status_code - $error_msg" >&2
            return 1
        fi
    done
    
    echo "Error: Max retries exceeded" >&2
    return 1
}

# Get input data for this execution
cronium_input() {
    _cronium_ready || return 1
    local response
    response=$(_cronium_request "GET" "/executions/${CRONIUM_EXECUTION_ID}/input")
    if [ $? -eq 0 ]; then
        # `== null` (not `//`): jq's `//` also swallows a legitimate `false`
        # value; only absent/null data may collapse to empty.
        echo "$response" | jq -r 'if .data == null then empty else .data end'
    else
        return 1
    fi
}

# Set output data for this execution
cronium_output() {
    _cronium_ready || return 1
    local data="$1"
    
    # Anything that is not a single JSON value is sent as a string. Asking
    # --argjson is what matters: `jq .` also passes an empty value and "1 2",
    # which --argjson then rejects below.
    if ! jq -n --argjson d "$data" '$d' >/dev/null 2>&1; then
        data=$(jq -n --arg d "$data" '$d')
    fi
    
    local payload=$(jq -n --argjson data "$data" '{data: $data}')
    _cronium_request "POST" "/executions/${CRONIUM_EXECUTION_ID}/output" "$payload" >/dev/null
}

# Get a variable value
cronium_get_variable() {
    _cronium_ready || return 1
    local key="$1"
    local encoded_key=$(printf '%s' "$key" | jq -sRr @uri)
    local response
    
    response=$(_cronium_request "GET" "/executions/${CRONIUM_EXECUTION_ID}/variables/${encoded_key}")
    if [ $? -eq 0 ]; then
        # `== null` (not `//`): preserve a legitimate `false` variable value.
        echo "$response" | jq -r 'if .data.value == null then empty else .data.value end'
    else
        return 1
    fi
}

# Set a variable value
cronium_set_variable() {
    _cronium_ready || return 1
    local key="$1"
    local value="$2"
    local encoded_key=$(printf '%s' "$key" | jq -sRr @uri)
    
    # See cronium_output. The runtime stores whatever arrives as a string.
    if ! jq -n --argjson v "$value" '$v' >/dev/null 2>&1; then
        value=$(jq -n --arg v "$value" '$v')
    fi
    
    local payload=$(jq -n --argjson value "$value" '{value: $value}')
    _cronium_request "PUT" "/executions/${CRONIUM_EXECUTION_ID}/variables/${encoded_key}" "$payload" >/dev/null
}

# Set workflow condition
cronium_set_condition() {
    _cronium_ready || return 1
    local condition="$1"
    
    # Convert to boolean
    case "$condition" in
        true|1|yes|on) condition=true ;;
        false|0|no|off) condition=false ;;
        *) 
            echo "Error: Invalid condition value. Use true/false, 1/0, yes/no, or on/off" >&2
            return 1
            ;;
    esac
    
    local payload=$(jq -n --argjson cond "$condition" '{condition: $cond}')
    _cronium_request "POST" "/executions/${CRONIUM_EXECUTION_ID}/condition" "$payload" >/dev/null
}

# Get event context
cronium_event() {
    _cronium_ready || return 1
    local response
    response=$(_cronium_request "GET" "/executions/${CRONIUM_EXECUTION_ID}/context")
    if [ $? -eq 0 ]; then
        echo "$response" | jq 'if .data == null then {} else .data end'
    else
        return 1
    fi
}

# Get specific event field
cronium_event_field() {
    _cronium_ready || return 1
    local field="$1"
    # `== null` (not `//`): a field whose value is `false` must print.
    cronium_event | jq -r "if .$field == null then empty else .$field end"
}

# Execute a tool action
cronium_execute_tool_action() {
    _cronium_ready || return 1
    local tool="$1"
    local action="$2"
    local config="$3"
    
    # Ensure config is valid JSON
    if ! echo "$config" | jq . >/dev/null 2>&1; then
        echo "Error: Invalid JSON configuration for tool action" >&2
        return 1
    fi
    
    local payload=$(jq -n \
        --arg tool "$tool" \
        --arg action "$action" \
        --argjson config "$config" \
        '{tool: $tool, action: $action, config: $config}')
    
    local response
    response=$(_cronium_request "POST" "/tool-actions/execute" "$payload")
    if [ $? -eq 0 ]; then
        # `== null` (not `//`): preserve a legitimate `false` result.
        echo "$response" | jq 'if .data == null then empty else .data end'
    else
        return 1
    fi
}

# Send an email
cronium_send_email() {
    _cronium_ready || return 1
    local to="$1"
    local subject="$2"
    local body="$3"
    shift 3
    
    # Build config object
    local config=$(jq -n \
        --arg to "$to" \
        --arg subject "$subject" \
        --arg body "$body" \
        '{to: ($to | split(",") | map(ltrimstr(" ") | rtrimstr(" "))), subject: $subject, body: $body}')
    
    # Add optional parameters
    while [ $# -gt 0 ]; do
        case "$1" in
            --cc)
                shift
                config=$(echo "$config" | jq --arg cc "$1" '.cc = ($cc | split(",") | map(ltrimstr(" ") | rtrimstr(" ")))')
                ;;
            --bcc)
                shift
                config=$(echo "$config" | jq --arg bcc "$1" '.bcc = ($bcc | split(",") | map(ltrimstr(" ") | rtrimstr(" ")))')
                ;;
            --html)
                config=$(echo "$config" | jq '.html = true')
                ;;
        esac
        shift
    done
    
    cronium_execute_tool_action "email" "send_message" "$config"
}

# Send a Slack message
cronium_send_slack_message() {
    _cronium_ready || return 1
    local channel="$1"
    local text="$2"
    shift 2
    
    local config=$(jq -n \
        --arg channel "$channel" \
        --arg text "$text" \
        '{channel: $channel, text: $text}')
    
    # Add optional parameters
    while [ $# -gt 0 ]; do
        case "$1" in
            --username)
                shift
                config=$(echo "$config" | jq --arg username "$1" '.username = $username')
                ;;
            --icon-emoji)
                shift
                config=$(echo "$config" | jq --arg icon "$1" '.icon_emoji = $icon')
                ;;
            --icon-url)
                shift
                config=$(echo "$config" | jq --arg icon "$1" '.icon_url = $icon')
                ;;
        esac
        shift
    done
    
    cronium_execute_tool_action "slack" "send_message" "$config"
}

# Send a Discord message
cronium_send_discord_message() {
    _cronium_ready || return 1
    local channel_id="$1"
    local content="$2"
    shift 2
    
    local config=$(jq -n \
        --arg channelId "$channel_id" \
        --arg content "$content" \
        '{channelId: $channelId, content: $content}')
    
    # Add optional embeds
    if [ $# -gt 0 ] && [ "$1" = "--embed" ]; then
        shift
        config=$(echo "$config" | jq --argjson embed "$1" '.embeds = [$embed]')
    fi
    
    cronium_execute_tool_action "discord" "send_message" "$config"
}

# Utility function to check if a variable exists
cronium_variable_exists() {
    _cronium_ready || return 1
    local key="$1"
    local value=$(cronium_get_variable "$key" 2>/dev/null)
    [ -n "$value" ]
}

# Utility function to delete a variable (set to null)
cronium_delete_variable() {
    _cronium_ready || return 1
    local key="$1"
    cronium_set_variable "$key" "null"
}

# Utility function to increment a numeric variable
cronium_increment_variable() {
    _cronium_ready || return 1
    local key="$1"
    local increment="${2:-1}"
    local current=$(cronium_get_variable "$key" 2>/dev/null || echo "0")
    current="${current:-0}"
    
    # Check if current value is numeric
    if ! [[ "$current" =~ ^-?[0-9]+$ ]]; then
        echo "Error: Variable '$key' is not numeric" >&2
        return 1
    fi
    
    local new_value=$((current + increment))
    cronium_set_variable "$key" "$new_value"
    echo "$new_value"
}

# Utility function to append to a string variable
cronium_append_variable() {
    _cronium_ready || return 1
    local key="$1"
    local append="$2"
    local separator="${3:-}"
    local current=$(cronium_get_variable "$key" 2>/dev/null || echo "")
    
    if [ -z "$current" ]; then
        cronium_set_variable "$key" "$append"
    else
        cronium_set_variable "$key" "${current}${separator}${append}"
    fi
}

# Print SDK info (useful for debugging)
cronium_info() {
    local token="${CRONIUM_EXECUTION_TOKEN:-${_cronium_token:-}}"
    echo "Cronium Bash SDK v2.0.0"
    echo "API URL: $CRONIUM_RUNTIME_API"
    echo "Execution ID: $CRONIUM_EXECUTION_ID"
    echo "Token: ${token:0:10}..." 
}

# Export all functions
export -f cronium_input
export -f cronium_output
export -f cronium_get_variable
export -f cronium_set_variable
export -f cronium_set_condition
export -f cronium_event
export -f cronium_event_field
export -f cronium_execute_tool_action
export -f cronium_send_email
export -f cronium_send_slack_message
export -f cronium_send_discord_message
export -f cronium_variable_exists
export -f cronium_delete_variable
export -f cronium_increment_variable
export -f cronium_append_variable
export -f cronium_info
export -f _cronium_ready
export -f _cronium_request