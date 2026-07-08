#!/usr/bin/env python3
import os
import sys

print("=== Environment Variables Test ===", file=sys.stderr)
env_vars = [
    "CRONIUM_EXECUTION_ID",
    "CRONIUM_JOB_ID", 
    "CRONIUM_EVENT_ID",
    "CRONIUM_HELPER_MODE",
    "CRONIUM_API_ENDPOINT",
    "CRONIUM_API_TOKEN",
    "CRONIUM_WORK_DIR"
]

for var in env_vars:
    value = os.environ.get(var, "NOT SET")
    if var == "CRONIUM_API_TOKEN" and value != "NOT SET":
        value = "SET (hidden)"
    print(f"{var}: {value}", file=sys.stderr)

print("\n=== Testing cronium helper ===", file=sys.stderr)
try:
    import cronium
    print("cronium module loaded successfully", file=sys.stderr)
    
    # Try to get a variable (this will fail but show debug output)
    try:
        result = cronium.getVariable("test")
        print(f"getVariable result: {result}", file=sys.stderr)
    except Exception as e:
        print(f"getVariable error (expected): {e}", file=sys.stderr)
        
except Exception as e:
    print(f"Failed to load cronium: {e}", file=sys.stderr)

print("\nTest complete!", file=sys.stderr)