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
#   some_command | cronium_output
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
    # A script's `set -u` applies in here too, and most callers have no body to send.
    local data="${3:-}"
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
        
        # The body goes on curl's stdin, because Linux refuses any one argument over 128 KB.
        if [ -n "$data" ]; then
            curl_args+=(--data-binary @-)
        fi
        
        # Make request and capture status code. curl's exit status must be
        # propagated out of the substitution explicitly — the pipeline runs
        # in a subshell, so a bare `$?` afterwards only ever saw tail's
        # (always zero) exit status and network failures were never retried.
        # The `||` is for a script's `set -e`, which otherwise ends it right here.
        curl_exit=0
        status_code=$(printf '%s' "$data" | curl "${curl_args[@]}" "${CRONIUM_RUNTIME_API}${path}" | tail -n1; exit "${PIPESTATUS[1]}") || curl_exit=$?

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
        
        # Check status code. The body has a say as well: a 200 that's empty, isn't JSON or
        # says {"success":false} didn't do what was asked, and as a read it would look like
        # a variable with no value. -s is what makes an empty body fail on every jq: with
        # no input, 1.6 exits 0 under -e where 1.7 exits 4.
        if [ "$status_code" -ge 200 ] && [ "$status_code" -lt 300 ] &&
            echo "$response" | jq -se 'length == 1 and .[0].success != false' >/dev/null 2>&1; then
            echo "$response"
            return 0
        elif [ "$status_code" -eq 404 ] && [ "$method" = "GET" ] && [[ "$path" == */variables/* ]]; then
            # Special case for variable not found. Input and context always exist, so a 404
            # for those is a failure like any other.
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
            echo "Error: API request failed - HTTP $status_code - ${error_msg:-no body}" >&2
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

# The jq definitions for telling whether a value is JSON by the JSON grammar, which is how a
# remote server's helpers decide. jq's own parser can't say: it also reads 010, +5, .5, nan and
# inf, and writes them back as 10, 5, 0.5, null and 1.7976931348623157e+308. So fromjson checks
# the structure, and this pattern checks what's left once the strings are out. Without the
# lookahead, 010 would pass as 0, 1 and 0.
#
# The pattern goes over 100,000 tokens at a time because of how long a value can be. All at
# once, it gives up at about 1.6 MB of short tokens (retry-limit-in-match), and it takes 312 MB
# of memory for a 5 MB string.
_cronium_json_defs() {
    printf '%s' '
        def number: "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][-+]?[0-9]+)?";
        def bare: "(?:true|false|null|" + number + ")(?![^\\]\\[{}:, \t\r\n])";
        def punctuation: "[\\]\\[{}:, \t\r\n]";
        def outside_strings:
            (split("\\\\") | add // "") | (split("\\\"") | add // "") |
            split("\"") | [.[range(0; length; 2)]] | add // "";
        def by_the_grammar:
            outside_strings | split(",") | . as $tokens
            | [range(0; length; 100000) as $i | $tokens[$i:$i + 100000] | map(. + ",") | add // "" |
               test("\\A(?:" + bare + "|" + punctuation + ")*+\\z")] | all;
    '
}

# Whether a value is one JSON value by the JSON grammar.
_cronium_is_json() {
    printf '%s' "$1" | jq -Rse "$(_cronium_json_defs)"'
        (try (fromjson | true) catch false) and by_the_grammar
    ' >/dev/null 2>&1
}

# Sets `payload` in the calling function to a request's body, {"<field>": <value>}. The value
# is the argument after <field>, even an empty one, or else all of stdin.
#
# It's what a remote server sends (jsonOrString in apps/runner/cronium-runner/internal/helpers/
# format.go). A single JSON value is sent as it was written, because jq would rewrite its
# numbers: 1e3 as 1E+3. Anything else is sent as a string with every byte in it, including the
# newline `echo` ends with, which $(...) would strip. The value stays out of jq's arguments,
# because Linux refuses any one argument over 128 KB.
#
# Something like megabytes of spaces around a value can still make the pattern give up. That
# value goes by jq's parser, and as jq writes it, because the text it accepted might not be JSON.
_cronium_value_payload() {
    local field="$1"
    shift
    local filter="$(_cronium_json_defs)"'
        . as $text
        | (try (fromjson | true) catch false) as $parses
        | (if $parses then (try by_the_grammar catch null) else false end) as $json
        | "{\"" + $field + "\":"
          + (if $json then $text elif $json == false then ($text | tojson) else ($text | fromjson | tojson) end)
          + "}"
    '

    # A job's stdin is at its end, as is a remote script's, so a call with nothing piped to it
    # sends an empty value straight away. Two other kinds of stdin would never get that far: a
    # terminal waits for someone to type, and in $(...) a closed one is that substitution's own
    # pipe, so reading it never ends. Inside $(...) it can't be told apart, so check out here.
    if [ "$#" -eq 0 ] && { [ -t 0 ] || ! { true 9<&0; } 2>/dev/null; }; then
        set -- ""
    fi

    if [ "$#" -gt 0 ]; then
        payload=$(printf '%s' "$1" | jq -Rsr --arg field "$field" "$filter")
    else
        payload=$(jq -Rsr --arg field "$field" "$filter")
    fi || {
        echo "Error: Could not read the value, so nothing was sent" >&2
        return 1
    }
}

# Set output data for this execution, from an argument or else from stdin
cronium_output() {
    _cronium_ready || return 1
    local payload
    _cronium_value_payload data "$@" || return 1
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

# Set a variable value, from an argument or else from stdin. The runtime stores whatever
# arrives as a string, and a JSON value as the text it was written in, so 010 and 1e3 read
# back as they were set.
cronium_set_variable() {
    _cronium_ready || return 1
    local key="$1"
    local encoded_key=$(printf '%s' "$key" | jq -sRr @uri)
    local payload
    _cronium_value_payload value "${@:2}" || return 1
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
    local event
    event=$(cronium_event) || return 1
    # `== null` (not `//`): a field whose value is `false` must print.
    echo "$event" | jq -r "if .$field == null then empty else .$field end"
}

# Execute a tool action
cronium_execute_tool_action() {
    _cronium_ready || return 1
    local tool="$1"
    local action="$2"
    local config="$3"
    
    # Ensure config is valid JSON
    if ! _cronium_is_json "$config"; then
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

# Utility function to check if a variable exists. Returns 0 if it has a value, 1 if it
# doesn't, and 2 if the read failed, which says nothing either way.
cronium_variable_exists() {
    _cronium_ready || return 1
    local key="$1"
    local value
    value=$(cronium_get_variable "$key") || {
        echo "Error: Could not tell whether variable '$key' exists" >&2
        return 2
    }
    [ -n "$value" ]
}

# Utility function to delete a variable (set to null)
cronium_delete_variable() {
    _cronium_ready || return 1
    local key="$1"
    cronium_set_variable "$key" "null"
}

# Prints a whole number with no plus sign or leading zeros, which is the form $((...)) reads
# as decimal, or returns 1 if it isn't a 64-bit integer. Left to itself, $((...)) reads a
# leading 0 as octal, a name as a variable and anything else as an expression, which can
# run commands. Past 64 bits it wraps without saying so, and then the number doesn't come
# back the same.
_cronium_integer() {
    local pattern='^([-+]?)0*([1-9][0-9]*|0)$'
    [[ "$1" =~ $pattern ]] || return 1
    local number="${BASH_REMATCH[1]#+}${BASH_REMATCH[2]}"
    [ "$number" = "-0" ] && number=0
    [ "$((number))" = "$number" ] || return 1
    echo "$number"
}

# Utility function to increment a numeric variable
cronium_increment_variable() {
    _cronium_ready || return 1
    local key="$1"
    local by="${2-1}"
    local increment
    local current
    increment=$(_cronium_integer "$by") || {
        echo "Error: Increment '$by' is not a 64-bit integer, so variable '$key' was not changed" >&2
        return 1
    }
    # Only a variable with no value starts from 0. One that couldn't be read still holds
    # its value, and anything written here would replace it.
    current=$(cronium_get_variable "$key") || {
        echo "Error: Could not read variable '$key', so it was not changed" >&2
        return 1
    }
    current=$(_cronium_integer "${current:-0}") || {
        echo "Error: Variable '$key' is not a 64-bit integer, so it was not changed" >&2
        return 1
    }
    
    local new_value=$((current + increment))
    if (( (increment > 0 && new_value < current) || (increment < 0 && new_value > current) )); then
        echo "Error: Adding $increment to variable '$key' goes past 64 bits, so it was not changed" >&2
        return 1
    fi
    cronium_set_variable "$key" "$new_value" || return 1
    echo "$new_value"
}

# Utility function to append to a string variable
cronium_append_variable() {
    _cronium_ready || return 1
    local key="$1"
    local append="$2"
    local separator="${3:-}"
    local current
    # See cronium_increment_variable.
    current=$(cronium_get_variable "$key") || {
        echo "Error: Could not read variable '$key', so it was not changed" >&2
        return 1
    }
    
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
    echo "API URL: ${CRONIUM_RUNTIME_API:-}"
    echo "Execution ID: ${CRONIUM_EXECUTION_ID:-}"
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
export -f _cronium_json_defs
export -f _cronium_is_json
export -f _cronium_value_payload
export -f _cronium_integer