#!/bin/bash

# Load input data automatically
_cronium_input_data=$(cat input.json 2>/dev/null || echo '{}')

# Load event data automatically
_cronium_event_data=$(cat event.json 2>/dev/null || echo '{}')

# Function to get input data
cronium_input() {
  echo "$_cronium_input_data"
}

# Function to set output data
cronium_output() {
  echo "$1" > output.json
}

# Function to get event metadata
cronium_event() {
  echo "$_cronium_event_data"
}

# Function to set condition flag
cronium_setCondition() {
  local condition="$1"
  local bool_condition="false"
  
  # Convert to boolean - anything non-empty/non-zero is true
  if [[ "$condition" == "true" || "$condition" == "1" || -n "$condition" && "$condition" != "false" && "$condition" != "0" ]]; then
    bool_condition="true"
  fi
  
  # Write condition to file for executor to read
  echo "{\"condition\": $bool_condition}" > condition.json
  
  # Store for later retrieval
  _cronium_condition="$bool_condition"
  
  echo "$bool_condition"
}

# Function to get condition flag
cronium_getCondition() {
  echo "$_cronium_condition"
}

# Function to get a variable value
cronium_getVariable() {
  local key="$1"
  
  if [[ ! -f "variables.json" ]]; then
    echo ""
    return
  fi
  
  # Use jq to extract the value, fallback to grep/sed if jq not available
  if command -v jq >/dev/null 2>&1; then
    jq -r ".$key // empty" variables.json 2>/dev/null
  else
    # Fallback method using grep and sed
    grep "\"$key\"" variables.json 2>/dev/null | sed 's/.*: *"\([^"]*\)".*/\1/' | head -1
  fi
}

# Function to set a variable value
cronium_setVariable() {
  local key="$1"
  local value="$2"
  local variables_data="{}"
  
  # Read existing variables if file exists
  if [[ -f "variables.json" ]]; then
    variables_data=$(cat variables.json 2>/dev/null || echo '{}')
  fi
  
  # Use jq to update the variable if available, otherwise use a simple method
  if command -v jq >/dev/null 2>&1; then
    echo "$variables_data" | jq --arg key "$key" --arg value "$value" --arg updated "$(date -Iseconds)" '. + {($key): $value, "__updated__": $updated}' > variables.json
  else
    # Fallback method - create a simple JSON structure
    echo "{\"$key\": \"$value\", \"__updated__\": \"$(date -Iseconds)\"}" > variables.json
  fi
  
  echo "true"
}