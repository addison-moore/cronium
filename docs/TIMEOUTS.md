# Timeout Configuration in Cronium

## Overview

Cronium implements a phase-based timeout system that separates infrastructure setup time from actual script execution time. This ensures that user-configured timeouts apply only to their script execution, not to the time required to set up containers, establish SSH connections, or deploy runners.

## Execution Phases

Every job execution in Cronium goes through three distinct phases:

### 1. Setup Phase

- **Container Execution**: Creating Docker networks, starting sidecars, pulling images, creating containers
- **SSH Execution**: Establishing SSH connections, deploying runner binaries, creating and transferring payloads
- **Default Timeout**: 5 minutes (configurable via `CRONIUM_SETUP_TIMEOUT`)

### 2. Execution Phase

- The actual execution of your script or command
- Uses the timeout configured by the user when creating the event
- Maximum timeout can be capped system-wide via `CRONIUM_MAX_EXECUTION_TIMEOUT`
- **Default**: 1 hour if not specified by user

### 3. Cleanup Phase

- **Container Execution**: Removing containers, networks, and sidecars
- **SSH Execution**: Removing payloads and cleaning up temporary files
- **Default Timeout**: 1 minute (configurable via `CRONIUM_CLEANUP_TIMEOUT`)
- Always runs, even if execution fails or times out

## User-Configured Timeouts

When creating an event, users can specify a timeout for their script execution:

```javascript
// Example event configuration
{
  script: {
    type: "BASH",
    content: "echo 'Hello World'; sleep 10; echo 'Done'",
    workingDirectory: "/tmp"
  },
  timeout: {
    value: 30,
    unit: "SECONDS"  // or "MINUTES", "HOURS", "DAYS"
  }
}
```

### Supported Timeout Units

- `SECONDS` (default if unit not specified)
- `MINUTES`
- `HOURS`
- `DAYS`

### Important Notes

- The user timeout applies **only** to the execution phase
- Setup time (pulling Docker images, SSH connection, etc.) does NOT count against the user timeout
- If no timeout is specified, defaults to 1 hour

## System-Wide Configuration

Administrators can configure phase timeouts via environment variables:

### Environment Variables

```bash
# Setup phase timeout (seconds)
# How long to wait for infrastructure setup
CRONIUM_SETUP_TIMEOUT=300  # 5 minutes (default)

# Cleanup phase timeout (seconds)
# How long to wait for resource cleanup
CRONIUM_CLEANUP_TIMEOUT=60  # 1 minute (default)

# Maximum execution timeout (seconds)
# Caps user-configured timeouts to prevent abuse
CRONIUM_MAX_EXECUTION_TIMEOUT=86400  # 24 hours (default)
```

### Configuration Examples

```bash
# Quick setup for development/testing
CRONIUM_SETUP_TIMEOUT=60        # 1 minute for setup
CRONIUM_CLEANUP_TIMEOUT=30      # 30 seconds for cleanup
CRONIUM_MAX_EXECUTION_TIMEOUT=3600  # 1 hour max execution

# Production configuration with longer timeouts
CRONIUM_SETUP_TIMEOUT=600       # 10 minutes for setup (large images)
CRONIUM_CLEANUP_TIMEOUT=120     # 2 minutes for cleanup
CRONIUM_MAX_EXECUTION_TIMEOUT=172800  # 48 hours max execution
```

## Timeout Behavior

### Setup Phase Timeout

If setup exceeds the configured timeout:

- Job fails with status `failed`
- Error message indicates which setup operation timed out
- Cleanup phase still runs to free resources

### Execution Phase Timeout

If script execution exceeds the user-configured timeout:

- Script process receives SIGTERM, then SIGKILL after 5 seconds
- Job fails with exit code `-1`
- Error message: "Script execution timed out"
- Partial output is preserved and returned

### Cleanup Phase Timeout

If cleanup exceeds timeout:

- Warning logged but job status not affected
- Resources may need manual cleanup
- Does not affect the job's final status

## Examples

### Example 1: Quick Script with Container Execution

```javascript
// User configuration
timeout: { value: 10, unit: "SECONDS" }

// Actual timing:
// - Setup: 3 seconds (pull small image)
// - Execution: 10 seconds (user timeout)
// - Cleanup: 0.5 seconds
// Total: 13.5 seconds
```

### Example 2: Long-Running SSH Job

```javascript
// User configuration
timeout: { value: 2, unit: "HOURS" }

// Actual timing:
// - Setup: 45 seconds (SSH connection + payload transfer)
// - Execution: 2 hours (user timeout)
// - Cleanup: 2 seconds
// Total: 2 hours 47 seconds
```

### Example 3: Timeout During Setup

```javascript
// User configuration
timeout: { value: 5, unit: "MINUTES" }

// System configuration
CRONIUM_SETUP_TIMEOUT=60  // 1 minute

// Result:
// - Setup phase times out after 1 minute
// - Job fails before script execution starts
// - User's 5-minute timeout never used
```

## Best Practices

1. **Set realistic timeouts**: Consider the actual runtime of your scripts, not infrastructure time
2. **Monitor setup times**: If setup frequently times out, increase `CRONIUM_SETUP_TIMEOUT`
3. **Use timeout units wisely**: Use MINUTES or HOURS for long-running jobs instead of large SECONDS values
4. **Test timeout behavior**: Test your jobs with various timeout scenarios in development
5. **Configure system limits**: Set `CRONIUM_MAX_EXECUTION_TIMEOUT` to prevent resource abuse

## Troubleshooting

### "Setup timeout exceeded" errors

- Increase `CRONIUM_SETUP_TIMEOUT` in orchestrator configuration
- Check network connectivity for Docker image pulls
- Verify SSH server responsiveness
- Consider pre-pulling large Docker images

### "Script execution timed out" errors

- Review your script's actual runtime
- Increase the timeout in your event configuration
- Check for infinite loops or hanging processes
- Verify script doesn't wait for user input

### Cleanup not completing

- Check `CRONIUM_CLEANUP_TIMEOUT` setting
- Review orchestrator logs for cleanup errors
- Manually clean up orphaned resources if needed

## Migration Notes

If upgrading from a version without phase-based timeouts:

1. User-configured timeouts now apply only to execution, not setup
2. Jobs that previously timed out during setup may now succeed
3. Review and adjust timeout values as needed
4. Set appropriate system-wide timeout limits

## Related Documentation

- [Event Configuration](./EVENTS.md)
- [Job Execution](./EXECUTION.md)
- [Environment Variables](./ENVIRONMENT_VARIABLES.md)
- [Orchestrator Configuration](./ORCHESTRATOR.md)
