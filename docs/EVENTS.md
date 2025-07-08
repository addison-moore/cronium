# ⚡ Cronium Events: The Heart of Automation

## Overview

Events are the fundamental building blocks of Cronium's automation platform. An Event represents a single executable unit of work—whether it's a script, an HTTP request, or a tool action. Events can be scheduled, triggered manually, or chained together in workflows to create sophisticated automation pipelines.

At its core, Cronium transforms the complexity of scheduled task management into a simple, visual experience. Instead of wrestling with cron syntax and server configurations, users can create, schedule, and monitor events through an intuitive interface that handles all the technical details behind the scenes.

## Current Implementation

### Event Types

Cronium currently supports five distinct event types, each optimized for specific use cases:

#### 1. **Node.js Scripts** 🟢

Execute JavaScript code with full access to the Node.js ecosystem. Perfect for:

- API integrations
- Data processing and transformation
- File system operations
- Database queries and updates

#### 2. **Python Scripts** 🐍

Run Python code with access to the entire Python ecosystem. Ideal for:

- Data science and machine learning tasks
- Scientific computing
- Web scraping
- Complex data analysis

#### 3. **Bash Scripts** 🖥️

Execute shell commands and scripts for system-level operations:

- Server maintenance and monitoring
- File management and backups
- System health checks
- DevOps automation

#### 4. **HTTP Requests** 🌐

Make HTTP calls to external APIs and services:

- Webhook triggers
- REST API interactions
- Health checks and monitoring
- Data synchronization

#### 5. **Tool Actions** 🔧 (New)

Execute pre-built integrations with third-party services:

- Send Slack messages
- Update Google Sheets
- Create Trello cards
- Manage cloud resources

### Core Features

#### 🕐 Flexible Scheduling

- **Manual Execution**: Run events on-demand with a single click
- **Time-based Scheduling**: Set intervals (minutes, hours, days, weeks, months)
- **Cron Expressions**: Advanced scheduling with full cron syntax support
- **Start Time Control**: Schedule events to begin at specific dates/times
- **Max Execution Limits**: Automatically stop after N executions

#### 🖥️ Execution Environments

- **Local Execution**: Run directly on the Cronium server
- **Remote Execution**: Execute on configured SSH-connected servers
- **Multi-Server Execution**: Run the same event across multiple servers
- **Container Support** (Planned): Isolated execution in Docker/LXC containers

#### 🔄 Runtime Features

- **Environment Variables**: Pass configuration securely to scripts
- **Timeout Controls**: Prevent runaway executions
- **Retry Logic**: Automatic retries on failure (0-10 attempts)
- **Execution Logs**: Complete stdout/stderr capture with timestamps
- **Real-time Monitoring**: Watch executions as they happen

#### 🔗 Conditional Actions

Execute follow-up actions based on event outcomes:

- **On Success**: Trigger when event completes successfully
- **On Failure**: Respond to errors and failures
- **Always**: Execute regardless of outcome
- **On Condition**: Custom logic based on output

Actions can:

- Trigger other events
- Send notifications (Email, Slack, Discord)
- Update variables
- Execute cleanup scripts

#### 📊 Data Flow

Cronium provides sophisticated data flow capabilities through runtime helpers:

```javascript
// cronium.js runtime helpers
const input = await cronium.input(); // Get data from previous event
await cronium.output({ result: data }); // Pass data to next event
const apiKey = await cronium.getVariable("API_KEY"); // Access variables
await cronium.setVariable("LAST_RUN", new Date()); // Store data
const eventInfo = cronium.event(); // Access event metadata
```

Similar helpers available for Python (`cronium.py`) and Bash (`cronium.sh`).

### Current UI/UX

#### Event Creation Form

The event form provides a comprehensive interface for configuring all aspects of an event:

1. **Basic Information**
   - Name and description
   - Event type selection
   - Tags for organization
   - Sharing controls (private/shared)

2. **Code Editor**
   - Monaco-based editor with syntax highlighting
   - Language-specific autocomplete
   - Theme customization
   - Built-in templates and examples

3. **Scheduling Configuration**
   - Visual schedule builder
   - Cron expression helper
   - Timezone support
   - Execution count controls

4. **Execution Settings**
   - Server selection (local/remote/multi)
   - Timeout configuration
   - Retry settings
   - Environment variables

5. **Conditional Actions**
   - Action type selection
   - Target configuration
   - Message templates
   - Variable mapping

#### Event Management Dashboard

- **List View**: Sortable, filterable event list
- **Status Indicators**: Active, draft, paused states
- **Quick Actions**: Start/stop, edit, clone, delete
- **Execution History**: Recent runs with status
- **Search & Filter**: By name, type, status, tags

#### Execution Monitoring

- **Real-time Logs**: Streaming output during execution
- **Status Timeline**: Visual execution progress
- **Performance Metrics**: Execution time, resource usage
- **Error Details**: Stack traces and debugging info

## Use Cases & Examples

### 1. Database Backup Automation

```bash
#!/bin/bash
# Daily PostgreSQL backup with rotation

DB_NAME="production"
BACKUP_DIR="/backups/postgres"
RETENTION_DAYS=7

# Create timestamped backup
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
pg_dump $DB_NAME > "$BACKUP_DIR/backup_$TIMESTAMP.sql"

# Compress backup
gzip "$BACKUP_DIR/backup_$TIMESTAMP.sql"

# Remove old backups
find $BACKUP_DIR -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete

# Output for next event
echo "{\"backup_file\": \"backup_$TIMESTAMP.sql.gz\"}"
```

**Configuration**:

- Schedule: Daily at 2 AM
- Timeout: 30 minutes
- On Success: Send Slack notification
- On Failure: Email admin team

### 2. API Data Synchronization

```javascript
// Sync customer data between systems
const axios = require("axios");

async function syncCustomers() {
  // Get updated customers from source
  const response = await axios.get("https://api.source.com/customers", {
    headers: { "API-Key": await cronium.getVariable("SOURCE_API_KEY") },
    params: {
      updated_since: await cronium.getVariable("LAST_SYNC_TIME"),
    },
  });

  // Transform and sync to destination
  for (const customer of response.data) {
    await axios.post(
      "https://api.destination.com/customers",
      {
        id: customer.external_id,
        name: customer.full_name,
        email: customer.email_address,
        // ... field mapping
      },
      {
        headers: { "API-Key": await cronium.getVariable("DEST_API_KEY") },
      },
    );
  }

  // Update sync timestamp
  await cronium.setVariable("LAST_SYNC_TIME", new Date().toISOString());

  // Output results
  await cronium.output({
    synced_count: response.data.length,
    last_sync: new Date().toISOString(),
  });
}

syncCustomers().catch(console.error);
```

**Configuration**:

- Schedule: Every 15 minutes
- Retry: 3 attempts
- On Failure: Create incident ticket

### 3. System Health Monitoring

```python
import psutil
import requests
import json

def check_system_health():
    # Collect system metrics
    metrics = {
        'cpu_percent': psutil.cpu_percent(interval=1),
        'memory_percent': psutil.virtual_memory().percent,
        'disk_usage': psutil.disk_usage('/').percent,
        'load_average': psutil.getloadavg()[0]
    }

    # Check critical thresholds
    alerts = []
    if metrics['cpu_percent'] > 80:
        alerts.append(f"High CPU usage: {metrics['cpu_percent']}%")
    if metrics['memory_percent'] > 90:
        alerts.append(f"High memory usage: {metrics['memory_percent']}%")
    if metrics['disk_usage'] > 85:
        alerts.append(f"Low disk space: {metrics['disk_usage']}% used")

    # Store metrics
    cronium.setVariable('LATEST_METRICS', json.dumps(metrics))

    # Output for conditional actions
    cronium.output({
        'healthy': len(alerts) == 0,
        'metrics': metrics,
        'alerts': alerts
    })

    # Return status for conditional logic
    return len(alerts) == 0

if __name__ == "__main__":
    is_healthy = check_system_health()
    exit(0 if is_healthy else 1)
```

**Configuration**:

- Schedule: Every 5 minutes
- Run Location: All production servers
- On Condition (unhealthy): Send PagerDuty alert

### 4. Workflow Example: Content Publishing

```yaml
Workflow: Publish Blog Post
Steps: 1. Extract Content (Python)
  - Parse markdown file
  - Extract metadata
  - Generate summary

  2. Optimize Images (Node.js)
  - Resize for different screens
  - Compress with quality settings
  - Upload to CDN

  3. Publish to CMS (HTTP Request)
  - POST to WordPress API
  - Include processed content
  - Set categories and tags

  4. Share on Social (Tool Actions)
  - Post to Twitter
  - Share on LinkedIn
  - Send to Slack channel

  5. Update Analytics (Python)
  - Log publication
  - Track metrics
  - Generate report
```

## Technical Architecture

### Database Schema

Events are stored with comprehensive metadata:

```typescript
interface Event {
  id: number;
  name: string;
  description?: string;
  type: EventType;
  content?: string; // Script content
  status: EventStatus;
  triggerType: EventTriggerType;

  // Scheduling
  scheduleNumber?: number;
  scheduleUnit?: TimeUnit;
  customSchedule?: string;
  startTime?: Date;
  maxExecutions: number;
  executionCount: number;

  // Execution settings
  runLocation: RunLocation;
  serverId?: number;
  selectedServerIds?: number[];
  timeoutValue: number;
  timeoutUnit: TimeUnit;
  retries: number;

  // HTTP specific
  httpMethod?: string;
  httpUrl?: string;
  httpHeaders?: HttpHeader[];
  httpBody?: string;

  // Tool Action specific
  toolActionConfig?: ToolActionConfig;

  // Metadata
  shared: boolean;
  tags: string[];
  envVars: EnvVar[];
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Execution Flow

1. **Scheduler** checks for events ready to execute
2. **Executor** prepares execution environment
3. **Runtime** injects helpers and variables
4. **Process** runs with configured limits
5. **Logger** captures all output
6. **Handler** processes conditional actions
7. **Storage** saves results and updates state

### API Architecture

Events are managed through tRPC endpoints:

- `events.getAll` - List events with filtering
- `events.getById` - Get single event details
- `events.create` - Create new event
- `events.update` - Modify existing event
- `events.delete` - Remove event
- `events.execute` - Trigger manual execution
- `events.logs` - Retrieve execution history
- `events.activate` - Enable scheduling
- `events.deactivate` - Disable scheduling

## Performance & Scalability

### Current Capabilities

- Handle 1000s of events per instance
- Execute 100s of concurrent scripts
- Process millions of executions monthly
- Sub-second scheduling precision
- Real-time log streaming

### Optimization Strategies

- Database indexing on critical fields
- Connection pooling for remote execution
- Efficient log rotation and archival
- Caching for frequently accessed data
- Async execution for long-running tasks

## Security Considerations

### Current Implementation

- **Authentication**: User-scoped events with role-based access
- **Isolation**: Process-level separation (container isolation planned)
- **Secrets**: Encrypted storage for sensitive variables
- **Audit**: Complete execution history and access logs
- **Validation**: Input sanitization and script validation

### Best Practices

- Use environment variables for credentials
- Implement least-privilege access
- Regular security audits
- Monitor for suspicious patterns
- Encrypt sensitive data in transit

## Future Roadmap

### Phase 1: Enhanced Execution (Q1 2025)

#### Container Isolation

- Docker/LXC support for secure execution
- Resource limits per event
- Network isolation options
- Custom runtime images

#### Advanced Scheduling

- Timezone-aware scheduling
- Holiday calendars
- Dependency-based triggers
- Event queuing and priorities

#### Improved Monitoring

- Real-time metrics dashboard
- Custom alerting rules
- Performance profiling
- Cost tracking

### Phase 2: Intelligent Automation (Q2 2025)

#### AI-Powered Features

- Natural language event creation
- Intelligent error resolution
- Pattern-based optimization
- Anomaly detection

#### Enhanced Workflows

- Visual workflow designer
- Branching and merging
- Parallel execution paths
- Sub-workflow templates

#### Collaboration Tools

- Event version control
- Change review process
- Team workspaces
- Shared libraries

### Phase 3: Enterprise Scale (Q3 2025)

#### High Availability

- Multi-region deployment
- Automatic failover
- Load balancing
- Disaster recovery

#### Advanced Security

- Hardware security modules
- Compliance certifications
- Advanced threat detection
- Zero-trust architecture

#### Developer Experience

- CLI tools
- IDE integrations
- API SDK
- Webhook marketplace

### Phase 4: Platform Evolution (Q4 2025)

#### Edge Computing

- Distributed execution
- Edge node deployment
- Offline capabilities
- Sync mechanisms

#### Advanced Integration

- GraphQL API
- WebAssembly support
- Blockchain triggers
- IoT device management

## Vision for the Future

### The Autonomous Automation Platform

Cronium Events will evolve into an intelligent automation platform that not only executes tasks but understands, optimizes, and self-heals. Imagine:

1. **Self-Optimizing Events**
   - AI analyzes execution patterns
   - Automatically adjusts schedules for efficiency
   - Suggests code improvements
   - Predicts and prevents failures

2. **Natural Language Automation**

   ```
   "Every Monday, check if our website is up,
    and if it's down, restart the server and
    notify the team on Slack"
   ```

   Automatically generates the complete event configuration.

3. **Intelligent Error Recovery**
   - Understands error contexts
   - Suggests fixes based on similar issues
   - Automatically implements approved solutions
   - Learns from resolution patterns

4. **Predictive Automation**
   - Anticipates needs based on patterns
   - Suggests new automations
   - Identifies optimization opportunities
   - Prevents issues before they occur

5. **Seamless Integration Ecosystem**
   - One-click connections to any service
   - Automatic API discovery
   - Self-documenting integrations
   - Universal data transformation

### Democratizing Automation

Our vision is to make automation accessible to everyone:

- **No-Code Power**: Visual builders for complex logic
- **Low-Code Flexibility**: Simple scripts for custom needs
- **Pro-Code Capability**: Full programming power when needed
- **AI-Assisted Everything**: Help at every step

### The Platform Economy

Transform Cronium into a thriving ecosystem:

- **Event Marketplace**: Buy, sell, and share automations
- **Certified Integrations**: Verified by partners
- **Community Templates**: Crowd-sourced solutions
- **Professional Services**: Expert automation consultants

## Getting Started with Events

### Quick Start

1. **Create Your First Event**
   - Click "New Event" in the dashboard
   - Choose your event type
   - Use a template or start fresh
   - Configure basic settings

2. **Test Your Event**
   - Use "Run Now" for immediate execution
   - Check logs for output
   - Adjust as needed
   - Save when satisfied

3. **Schedule Your Event**
   - Set your preferred schedule
   - Configure retries if needed
   - Add conditional actions
   - Activate the event

4. **Monitor & Maintain**
   - Track execution history
   - Review performance metrics
   - Update as requirements change
   - Share with team members

### Best Practices

1. **Event Design**
   - Keep events focused on single tasks
   - Use meaningful names and descriptions
   - Add comprehensive error handling
   - Include helpful log messages

2. **Security**
   - Never hardcode credentials
   - Use environment variables
   - Implement input validation
   - Follow least-privilege principles

3. **Performance**
   - Set appropriate timeouts
   - Optimize for efficiency
   - Use caching when possible
   - Monitor resource usage

4. **Maintenance**
   - Regular review of active events
   - Clean up obsolete events
   - Update dependencies
   - Document complex logic

## Conclusion

Cronium Events represents a fundamental shift in how we think about automation. By combining the simplicity of a visual interface with the power of code execution, we've created a platform that serves everyone from business users to seasoned developers.

The current implementation provides a robust foundation for automation needs, while our ambitious roadmap promises to transform Events into an intelligent, self-improving system that anticipates needs and prevents problems before they occur.

Whether you're automating simple tasks or orchestrating complex enterprise workflows, Cronium Events provides the tools, flexibility, and reliability you need to succeed. Start with a single event today, and discover how Cronium can transform your automation journey.
