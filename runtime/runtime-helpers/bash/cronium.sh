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

# Configuration from environment
CRONIUM_API="${CRONIUM_RUNTIME_API:-http://localhost:8081}"
CRONIUM_TOKEN="${CRONIUM_EXECUTION_TOKEN}"
CRONIUM_EXEC_ID="${CRONIUM_EXECUTION_ID}"

# Retry configuration
MAX_RETRIES=3
RETRY_DELAY=1

# Check required environment variables
if [ -z "$CRONIUM_TOKEN" ]; then
    echo "Error: CRONIUM_EXECUTION_TOKEN environment variable not set" >&2
    exit 1
fi

if [ -z "$CRONIUM_EXEC_ID" ]; then
    echo "Error: CRONIUM_EXECUTION_ID environment variable not set" >&2
    exit 1
fi

# Check for required commands
for cmd in curl jq; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "Error: Required command '$cmd' not found" >&2
        exit 1
    fi
done

# Helper function to make API requests with retry logic
_cronium_request() {
    local method="$1"
    local path="$2"
    local data="$3"
    local attempt=1
    local response
    local status_code
    local temp_file=$(mktemp)
    
    while [ $attempt -le $MAX_RETRIES ]; do
        # Build curl command
        local curl_args=(
            -s
            -X "$method"
            -H "Authorization: Bearer $CRONIUM_TOKEN"
            -H "Content-Type: application/json"
            -H "Accept: application/json"
            -w "\n%{http_code}"
            --max-time 30
            -o "$temp_file"
        )
        
        if [ -n "$data" ]; then
            curl_args+=(-d "$data")
        fi
        
        # Make request and capture status code
        status_code=$(curl "${curl_args[@]}" "${CRONIUM_API}${path}" | tail -n1)
        
        # Check if curl succeeded
        if [ $? -ne 0 ]; then
            if [ $attempt -lt $MAX_RETRIES ]; then
                sleep $((RETRY_DELAY * attempt))
                ((attempt++))
                continue
            fi
            rm -f "$temp_file"
            echo "Error: Request failed after $MAX_RETRIES attempts" >&2
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
        elif [ "$status_code" -ge 500 ] && [ $attempt -lt $MAX_RETRIES ]; then
            # Retry on server errors
            sleep $((RETRY_DELAY * attempt))
            ((attempt++))
            continue
        else
            # Client error or final attempt
            local error_msg=$(echo "$response" | jq -r '.message // "Unknown error"' 2>/dev/null || echo "HTTP $status_code")
            echo "Error: API request failed - $error_msg" >&2
            return 1
        fi
    done
    
    echo "Error: Max retries exceeded" >&2
    return 1
}

# Get input data for this execution
cronium_input() {
    local response
    response=$(_cronium_request "GET" "/executions/${CRONIUM_EXEC_ID}/input")
    if [ $? -eq 0 ]; then
        echo "$response" | jq -r '.data // empty'
    else
        return 1
    fi
}

# Set output data for this execution
cronium_output() {
    local data="$1"
    
    # Ensure data is valid JSON
    if ! echo "$data" | jq . >/dev/null 2>&1; then
        # If not valid JSON, wrap as string
        data=$(jq -n --arg d "$data" '$d')
    fi
    
    local payload=$(jq -n --argjson data "$data" '{data: $data}')
    _cronium_request "POST" "/executions/${CRONIUM_EXEC_ID}/output" "$payload" >/dev/null
}

# Get a variable value
cronium_get_variable() {
    local key="$1"
    local encoded_key=$(printf '%s' "$key" | jq -sRr @uri)
    local response
    
    response=$(_cronium_request "GET" "/executions/${CRONIUM_EXEC_ID}/variables/${encoded_key}")
    if [ $? -eq 0 ]; then
        echo "$response" | jq -r '.data.value // empty'
    else
        return 1
    fi
}

# Set a variable value
cronium_set_variable() {
    local key="$1"
    local value="$2"
    local encoded_key=$(printf '%s' "$key" | jq -sRr @uri)
    
    # Ensure value is valid JSON
    if ! echo "$value" | jq . >/dev/null 2>&1; then
        # If not valid JSON, wrap as string
        value=$(jq -n --arg v "$value" '$v')
    fi
    
    local payload=$(jq -n --argjson value "$value" '{value: $value}')
    _cronium_request "PUT" "/executions/${CRONIUM_EXEC_ID}/variables/${encoded_key}" "$payload" >/dev/null
}

# Set workflow condition
cronium_set_condition() {
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
    _cronium_request "POST" "/executions/${CRONIUM_EXEC_ID}/condition" "$payload" >/dev/null
}

# Get event context
cronium_event() {
    local response
    response=$(_cronium_request "GET" "/executions/${CRONIUM_EXEC_ID}/context")
    if [ $? -eq 0 ]; then
        echo "$response" | jq '.data // {}'
    else
        return 1
    fi
}

# Get specific event field
cronium_event_field() {
    local field="$1"
    cronium_event | jq -r ".$field // empty"
}

# Execute a tool action
cronium_execute_tool_action() {
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
        echo "$response" | jq '.data // empty'
    else
        return 1
    fi
}

# Send an email
cronium_send_email() {
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
    local key="$1"
    local value=$(cronium_get_variable "$key" 2>/dev/null)
    [ -n "$value" ]
}

# Utility function to delete a variable (set to null)
cronium_delete_variable() {
    local key="$1"
    cronium_set_variable "$key" "null"
}

# Utility function to increment a numeric variable
cronium_increment_variable() {
    local key="$1"
    local increment="${2:-1}"
    local current=$(cronium_get_variable "$key" 2>/dev/null || echo "0")
    
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
    echo "Cronium Bash SDK v2.0.0"
    echo "API URL: $CRONIUM_API"
    echo "Execution ID: $CRONIUM_EXEC_ID"
    echo "Token: ${CRONIUM_TOKEN:0:10}..." 
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
export -f _cronium_request