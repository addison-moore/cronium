# Cronium Feature List

This document provides a comprehensive overview of all major features in Cronium, an open-source, self-hosted automation platform.

## Core Features

### 1. Events - The Building Blocks of Automation

Events are the fundamental units of automation in Cronium. Each event represents a single executable task.

**Event Types:**

- **Script Events**: Execute code in Bash, Python, or Node.js
- **HTTP Request Events**: Make API calls to external services
- **Tool Action Events**: No-code integrations with third-party services
- **Workflow Events**: Multi-step automation pipelines

**Key Capabilities:**

- **Flexible Scheduling**: Manual triggers, interval-based schedules, or cron expressions
- **Execution Locations**: Run locally or on remote servers via SSH
- **Multi-Server Support**: Execute the same event across multiple servers simultaneously
- **Resource Management**: Configurable timeouts and retry logic
- **Data Flow**: Pass data between events using runtime helpers
- **Conditional Actions**: Trigger follow-up actions based on success/failure/custom conditions
- **Environment Variables**: Secure storage and injection of runtime variables
- **Comprehensive Logging**: Full execution history with stdout/stderr capture

### 2. Workflows - Visual Automation Pipelines

Workflows allow users to chain multiple events into sophisticated automation pipelines with conditional logic.

**Features:**

- **Visual Designer**: Drag-and-drop interface built with React Flow
- **DAG Structure**: Directed Acyclic Graph ensures no infinite loops
- **Connection Types**:
  - ALWAYS: Execute next node regardless
  - ON_SUCCESS: Proceed only on success
  - ON_FAILURE: Error handling paths
  - ON_CONDITION: Custom logic based on outputs
- **Data Passing**: Automatic data flow between connected nodes
- **Parallel Execution**: Independent branches run simultaneously
- **Trigger Options**: Manual, scheduled, or webhook triggers
- **Execution Tracking**: Node-by-node status and performance metrics

### 3. Remote Execution

Execute scripts and commands on remote servers via SSH.

**Capabilities:**

- **Server Management**: Add and manage remote servers with SSH keys
- **Connection Pooling**: Efficient connection reuse for better performance
- **Multi-Server Execution**: Run events on multiple servers simultaneously
- **Interactive Terminal**: Full terminal access via xterm.js
- **Health Monitoring**: Automatic server status checking
- **Shell Detection**: Automatic detection of user's default shell
- **Runtime Helper Support**: Same APIs work locally and remotely

### 4. Tool Actions - No-Code Integrations

Pre-built integrations with popular services that don't require coding.

**Currently Supported Tools:**

- **Communication**: Slack, Discord, Email, Microsoft Teams
- **Productivity**: Notion, Trello, Google Sheets
- **Development**: Webhook (generic HTTP requests)

**Features:**

- **Visual Configuration**: Form-based setup without coding
- **Credential Management**: Secure storage of API keys and tokens
- **Template System**: Save and reuse common configurations
- **Variable Integration**: Use Cronium variables in parameters
- **Rich Content Editors**: Monaco editor for JSON/HTML content
- **Health Monitoring**: Track connection status and success rates
- **Audit Logging**: Complete execution history

### 5. Variables System

Centralized management of configuration values and secrets.

**Features:**

- **Secure Storage**: Encrypted storage for sensitive values
- **Variable Scoping**: User-specific variables
- **Access Methods**:
  - `cronium.getVariable()` - Read variables in scripts
  - `cronium.setVariable()` - Update variables from scripts
- **Management UI**: Create, edit, delete, and search variables
- **Export Options**: JSON, ENV, or CSV formats
- **Usage Tracking**: See which events use each variable
- **Validation**: Prevent reserved variable names

### 6. Containerized Execution (In Development)

A major security enhancement currently being implemented to isolate script execution.

**Planned Features:**

- **Docker Container Isolation**: Each script runs in its own container
- **Resource Limits**: CPU, memory, and PID limits
- **Security Constraints**: Non-root execution, dropped capabilities
- **Custom Images**: Optimized Alpine-based images for each language
- **Go Orchestrator**: High-performance orchestration service
- **Real-time Logging**: WebSocket-based log streaming

### 7. Authentication & User Management

Comprehensive authentication and access control system.

**Features:**

- **Email/Password Authentication**: Secure login with bcrypt hashing
- **Role-Based Access**: Admin, User, and Viewer roles
- **User Management**: Admin dashboard for user administration
- **Invite System**: Admins can invite new users
- **Password Reset**: Token-based password recovery
- **Session Management**: Secure cookie-based sessions

### 8. Monitoring & Logging

Comprehensive system for tracking execution and system health.

**Dashboard Metrics:**

- Event statistics (total, active, paused, draft)
- Execution metrics (success rate, failure rate)
- Server health status
- Workflow performance data

**Activity Tracking:**

- Real-time activity feed
- Execution history with duration
- Status indicators and filtering
- Export capabilities for analysis

**System Monitoring (Admin):**

- Resource metrics (CPU, memory, uptime)
- Database and service health checks
- Error tracking and analytics
- Historical trend analysis

### 9. Developer Experience

Modern tech stack and developer-friendly features.

**Technology Stack:**

- **Frontend**: Next.js 15 with App Router, TypeScript, TailwindCSS 4
- **Backend**: tRPC for type-safe APIs, Drizzle ORM
- **Database**: PostgreSQL with Neon
- **Real-time**: Socket.IO for WebSocket support
- **Forms**: React Hook Form with Zod validation

**Developer Features:**

- Type-safe end-to-end development
- Comprehensive test suite
- RESTful and tRPC APIs
- WebSocket support for real-time features
- Extensive documentation

### 10. UI/UX Features

Modern, responsive interface designed for ease of use.

**Components:**

- **Responsive Design**: Works on desktop and mobile
- **Dark Mode**: Full dark mode support
- **Internationalization**: Multi-language support with next-intl
- **Real-time Updates**: Live activity feeds and status updates
- **Interactive Elements**: Charts, progress bars, and visual indicators
- **Toast Notifications**: User feedback for all actions

## Security Features

- **Encrypted Storage**: Sensitive data encrypted at rest
- **Role-Based Access Control**: Granular permissions system
- **SSH Key Management**: Secure storage of SSH credentials
- **API Token System**: Secure API access
- **Audit Logging**: Complete audit trail of all actions
- **Rate Limiting**: Protection against abuse
- **Container Isolation**: (Coming soon) Secure script execution

## Upcoming Features

Based on development plans:

- **OAuth Support**: Native OAuth for tool integrations
- **Edge Computing**: Distributed execution capabilities

---

Cronium combines the power of traditional scripting with modern automation needs, providing a secure, scalable, and user-friendly platform for all automation requirements.
