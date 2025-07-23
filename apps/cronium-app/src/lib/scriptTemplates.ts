import { EventType } from "@/shared/schema";

/**
 * Default script templates for different event types.
 */

const NODEJS_TEMPLATE = `/**
 * Example Node.js script with unified I/O
 */
console.log('Starting Node.js script execution...');

// Access input data
const inputData = cronium.input();
console.log('Input received:', inputData);

// Example: Access environment variables
const exampleApiKey = process.env.EXAMPLE_API_KEY;
console.log('Environment variable example:', exampleApiKey ? 'API key found' : 'No API key set');

// Your script logic goes here
async function main() {
  try {
    console.log('Running main function...');
    
    // Process input data
    const inputData = cronium.input();
    const result = {
      success: true,
      message: "Node.js processing completed",
      processed_input: inputData,
      calculation_result: 42,
      timestamp: new Date().toISOString()
    };
    
    console.log('Processing result:', result);
    
    // Set output for next workflow node or API response
    cronium.output(result);
    
    return result;
  } catch (error) {
    console.error('Error in script execution:', error);
    
    // Even on error, provide structured output
    const errorResult = {
      success: false,
      error: error.message,
      input_received: cronium.input(),
      timestamp: new Date().toISOString()
    };
    
    cronium.output(errorResult);
    return errorResult;
  }
}

// Execute the main function
main()
  .then(result => console.log('Script completed successfully'))
  .catch(error => console.error('Script failed with error:', error));
`;

const PYTHON_TEMPLATE = `#!/usr/bin/env python3
# Example Python script with unified I/O

import os
import sys
import json
from datetime import datetime

print("Starting Python script execution...")

# Access input data
input_data = cronium.input()
print(f"Input received: {input_data}")

# Example: Access environment variables
example_api_key = os.environ.get('EXAMPLE_API_KEY')
print(f"Environment variable example: {'API key found' if example_api_key else 'No API key set'}")

# Your script logic goes here
def main():
    try:
        print("Running main function...")
        
        # Process input data
        input_data = cronium.input()
        result = {
            "success": True,
            "message": "Python processing completed",
            "processed_input": input_data,
            "calculation_result": 42,
            "timestamp": datetime.now().isoformat()
        }
        
        print(f"Processing result: {result}")
        
        # Set output for next workflow node or API response
        cronium.output(result)
        
        return result
    except Exception as e:
        print(f"Error in script execution: {str(e)}")
        
        # Even on error, provide structured output
        error_result = {
            "success": False,
            "error": str(e),
            "input_received": cronium.input(),
            "timestamp": datetime.now().isoformat()
        }
        
        cronium.output(error_result)
        return error_result

# Execute the main function
if __name__ == "__main__":
    result = main()
    print("Script completed successfully")
`;

const BASH_TEMPLATE = `#!/bin/bash
# Example Bash script with unified I/O

echo "Starting Bash script execution..."

# Access input data
input_data=$(cronium_input)
echo "Input received: $input_data"

# Example: Access environment variables
if [ -n "$EXAMPLE_API_KEY" ]; then
    echo "Environment variable example: API key found"
else
    echo "Environment variable example: No API key set"
fi

# Your script logic goes here
echo "Running main processing..."

# Process input data using jq (if available)
if command -v jq >/dev/null 2>&1; then
    user_id=$(echo "$input_data" | jq -r '.user_id // "unknown"')
    echo "Processing for user: $user_id"
fi

# Example: Create a timestamp
TIMESTAMP=$(date -Iseconds)
echo "Current timestamp: $TIMESTAMP"

# Example: Simple calculation
RESULT=42
echo "Calculation result: $RESULT"

# Create output data
output_data=$(cat << EOF
{
  "success": true,
  "message": "Bash processing completed",
  "processed_input": $input_data,
  "calculation_result": $RESULT,
  "timestamp": "$TIMESTAMP"
}
EOF
)

# Set output for next workflow node or API response
cronium_output "$output_data"

echo "Script execution completed successfully!"
`;

const HTTP_REQUEST_TEMPLATE = {
  method: "GET",
  url: "https://api.example.com/data",
  headers: [{ key: "Content-Type", value: "application/json" }],
  body: JSON.stringify(
    {
      query: "example",
      limit: 10,
    },
    null,
    2,
  ),
};

/**
 * Get the default script content based on script type
 */
export function getDefaultScriptContent(type: EventType): string {
  switch (type) {
    case EventType.NODEJS:
      return NODEJS_TEMPLATE;
    case EventType.PYTHON:
      return PYTHON_TEMPLATE;
    case EventType.BASH:
      return BASH_TEMPLATE;
    case EventType.HTTP_REQUEST:
      return ""; // HTTP requests don't use the content field directly
    default:
      return "// Add your script here";
  }
}

/**
 * Get the default HTTP request settings
 */
export function getDefaultHttpRequest() {
  return HTTP_REQUEST_TEMPLATE;
}
