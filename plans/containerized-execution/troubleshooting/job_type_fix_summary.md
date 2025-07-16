# Job Type Mismatch Fix Summary

## Problem

When creating a Bash event and clicking "Run Now", the job was created with type "SCRIPT" but failed immediately because the orchestrator doesn't recognize "SCRIPT" as a valid job type. The orchestrator only accepts "container" or "ssh" job types.

## Root Cause

1. **TypeScript/Database Schema**: Uses job types: `SCRIPT`, `HTTP_REQUEST`, `TOOL_ACTION`
2. **Go Orchestrator**: Only recognizes job types: `container`, `ssh`
3. **Missing Transformation**: The API was passing job data directly without transforming it to the orchestrator's expected format

## Solution

Created a transformation layer that:

1. Maps job types appropriately:
   - `SCRIPT` → `container` (for local execution) or `ssh` (for remote execution)
   - `HTTP_REQUEST` → `container`
   - `TOOL_ACTION` → `container`

2. Restructures the job payload to match orchestrator expectations:
   - Moves script/HTTP/tool configurations into an `execution` object
   - Properly formats the `target` field
   - Converts script types to lowercase (BASH → bash)
   - Adds proper timeout and resource configurations

## Files Modified

1. **Created**: `src/lib/services/job-transformer.ts`
   - New transformation functions to convert jobs to orchestrator format

2. **Modified**: `src/app/api/internal/jobs/queue/route.ts`
   - Added transformation before returning jobs to orchestrator

3. **Fixed**: `src/lib/scheduler/job-scheduling-utils.ts`
   - Removed duplicate variable declaration

## How It Works

### Before (Failing)

```json
{
  "type": "SCRIPT",
  "payload": {
    "script": {
      "type": "BASH",
      "content": "echo 'Hello'"
    }
  }
}
```

### After (Working)

```json
{
  "type": "container",
  "execution": {
    "target": {
      "type": "local"
    },
    "script": {
      "type": "bash",
      "content": "echo 'Hello'"
    },
    "environment": {},
    "timeout": 3600
  }
}
```

## Testing

1. Create a Bash event
2. Click "Run Now"
3. Job should now:
   - Be created with status "queued"
   - Be claimed by the orchestrator
   - Execute successfully in a container
   - Show logs in real-time

## Additional Benefits

- Maintains backward compatibility with existing database schema
- Allows for future expansion of job types without breaking the orchestrator
- Provides a clear separation between internal job representation and orchestrator API

## Next Steps

1. Test with different event types (Python, Node.js, HTTP requests)
2. Verify remote SSH execution works correctly
3. Add unit tests for the transformation logic
4. Consider adding validation to ensure all required fields are present
