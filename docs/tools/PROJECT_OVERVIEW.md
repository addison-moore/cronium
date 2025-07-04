# Tool Actions: First-Class Event Type Project Overview

## Executive Summary

This document outlines the project to introduce **Tool Actions** as a first-class event type in Cronium, enabling users to execute third-party tool actions directly as scheduled or manual events. This builds upon the existing Modular Tools Manager infrastructure while expanding capabilities from simple message notifications to comprehensive tool integrations.

## Project Goals

### Primary Objectives

1. **Expand Event Type System**: Add `TOOL_ACTION` as a new event type alongside existing `PYTHON`, `BASH`, `NODEJS`, and `HTTP_REQUEST` types
2. **Leverage Existing Infrastructure**: Build upon the current Modular Tools Manager and plugin system
3. **Provide Intuitive UI/UX**: Create a user-friendly interface for configuring and managing tool actions
4. **Ensure Extensibility**: Design a modular architecture that supports easy addition of new tools and actions
5. **Maintain Backward Compatibility**: Preserve existing "Send Message" conditional actions functionality

### Secondary Objectives

1. **Standardize Tool Integration**: Establish consistent patterns for tool action definitions and execution
2. **Enhance Workflow Capabilities**: Enable tool actions as workflow nodes for complex automation
3. **Improve User Productivity**: Reduce manual configuration complexity for common tool operations
4. **Support Advanced Use Cases**: Enable complex data transformations and multi-step tool workflows

## Architecture Analysis

### Current State Assessment

#### Existing Modular Tools Manager

- **Plugin System**: Well-established `ToolPlugin` interface with registry pattern
- **Current Tools**: Email, Slack, Discord with credential management and templates
- **Usage Pattern**: Limited to conditional "Send Message" actions post-event execution
- **UI Components**: Tabbed interface with credentials and templates management

#### Current Event System

- **Event Types**: `PYTHON`, `BASH`, `NODEJS`, `HTTP_REQUEST` with specific form handling
- **Event Form**: Single form component handling all event types with conditional rendering
- **Execution Engine**: Supports local/remote execution with timeout and retry logic
- **Conditional Actions**: Basic system for post-execution actions including tool messaging

### Proposed Architecture

#### Tool Action Event Type

```typescript
// New event type addition
export enum EventType {
  NODEJS = "NODEJS",
  PYTHON = "PYTHON",
  BASH = "BASH",
  HTTP_REQUEST = "HTTP_REQUEST",
  TOOL_ACTION = "TOOL_ACTION", // New addition
}
```

#### Tool Action Schema

```typescript
interface ToolActionConfig {
  toolType: string; // e.g., "trello", "google-sheets"
  actionType: string; // e.g., "add-card", "append-row"
  toolId: number; // Reference to configured tool credentials
  parameters: Record<string, any>; // Action-specific parameters
  outputMapping?: Record<string, string>; // For data transformation
}
```

## Design Principles

### 1. Modularity and Extensibility

- **Plugin-Based Architecture**: Each tool is a self-contained plugin with defined interfaces
- **Action-Driven Design**: Tools expose discrete actions rather than generic operations
- **Schema-Based Validation**: Each action defines its parameter schema using Zod
- **Category Organization**: Tools grouped by categories (Communication, Database, Productivity, etc.)

### 2. Consistency and Standardization

- **Unified Plugin Interface**: All tools implement the same base `ToolPlugin` interface
- **Consistent Execution Model**: Tool actions follow the same execution patterns as existing event types
- **Standardized Error Handling**: Common error handling and retry logic across all tools
- **Uniform Data Flow**: Consistent input/output patterns for tool actions

### 3. User Experience Focus

- **Intuitive Configuration**: Step-by-step wizard for tool action setup
- **Real-time Validation**: Immediate feedback on parameter validation
- **Template Support**: Pre-configured action templates for common use cases
- **Visual Action Builder**: Drag-and-drop interface for complex workflows

### 4. Backward Compatibility

- **Preserve Existing Functionality**: Current "Send Message" actions remain unchanged
- **Migration Path**: Clear upgrade path from conditional actions to tool actions
- **API Stability**: Maintain existing tRPC endpoints and database schemas

## Technical Requirements

### 1. Enhanced Plugin System

#### Action Definition

```typescript
interface ToolAction {
  id: string;
  name: string;
  description: string;
  category: string;
  inputSchema: z.ZodSchema<any>;
  outputSchema: z.ZodSchema<any>;
  execute: (credentials: any, params: any) => Promise<any>;
}

interface ToolPlugin {
  // ... existing properties
  actions: ToolAction[];
  getActionById: (id: string) => ToolAction | undefined;
}
```

#### Action Configuration UI

- Dynamic form generation based on action schema
- Parameter validation and type checking
- Real-time preview of action execution
- Support for complex data types (arrays, objects, files)

### 2. Event Form Integration

#### Tool Action Section

- Tool selection dropdown (filtered by available credentials)
- Action selection based on chosen tool
- Dynamic parameter form based on action schema
- Output mapping configuration for data transformation

#### Execution Context

- Access to Cronium runtime helpers (`cronium.getVariable()`, etc.)
- Integration with existing timeout and retry mechanisms
- Support for environment variables and secrets

### 3. Database Schema Extensions

#### Tool Actions Storage

```sql
-- Extend events table
ALTER TABLE events ADD COLUMN tool_action_config JSONB;

-- New table for action execution logs
CREATE TABLE tool_action_logs (
  id SERIAL PRIMARY KEY,
  event_id INTEGER REFERENCES events(id),
  tool_type VARCHAR(50) NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  parameters JSONB,
  result JSONB,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 4. Execution Engine Integration

#### Action Execution

- Validate action parameters against schema
- Load tool credentials securely
- Execute action with proper error handling
- Store execution results and logs
- Support for async operations and polling

#### Result Processing

- Transform action output using configured mapping
- Store results in Cronium variables
- Trigger subsequent workflow steps
- Handle partial failures in multi-step actions

## Implementation Challenges

### 1. Schema Evolution and Versioning

**Challenge**: Tool APIs evolve, requiring schema updates without breaking existing configurations
**Mitigation**:

- Implement schema versioning system
- Provide migration utilities for schema changes
- Use optional fields and default values for backward compatibility
- Store schema version with each action configuration

### 2. Credential Management Security

**Challenge**: Secure storage and transmission of third-party API credentials
**Mitigation**:

- Use existing encryption service for credential storage
- Implement credential rotation mechanisms
- Add audit logging for credential access
- Support OAuth2 flows for modern APIs

### 3. Rate Limiting and API Quotas

**Challenge**: Managing API rate limits and quotas across multiple users and tools
**Mitigation**:

- Implement rate limiting middleware
- Add quota tracking and reporting
- Provide queue management for high-volume operations
- Support API key pooling for enterprise usage

### 4. Error Handling Complexity

**Challenge**: Handling diverse error conditions across different tool APIs
**Mitigation**:

- Standardize error response format
- Implement retry logic with exponential backoff
- Add circuit breaker pattern for failing services
- Provide detailed error logging and debugging

### 5. UI/UX Complexity

**Challenge**: Creating intuitive interfaces for complex tool configurations
**Mitigation**:

- Implement progressive disclosure patterns
- Provide action templates and wizards
- Add real-time validation and preview
- Create comprehensive help documentation

### 6. Performance and Scalability

**Challenge**: Ensuring system performance with potentially long-running tool actions
**Mitigation**:

- Implement asynchronous execution for long-running actions
- Add progress tracking and cancellation support
- Use connection pooling for database operations
- Implement caching for frequently accessed data

## Integration Opportunities

### 1. Existing Plugin Framework Libraries

- **Zapier Platform**: Learn from established patterns for tool integration
- **n8n**: Learn from established patterns for tool integration
- **Integromat/Make**: Study visual workflow builders
- **IFTTT**: Analyze simple trigger-action patterns
- **Microsoft Power Automate**: Examine enterprise-grade connectors

### 2. Tool-Specific SDKs and APIs

- **Trello API**: Well-documented REST API with comprehensive JavaScript SDK
- **Google Workspace APIs**: Mature SDKs with OAuth2 support
- **Slack API**: Excellent documentation and SDK ecosystem
- **Asana API**: Clean REST API with good error handling
- **Jira API**: Enterprise-grade API with extensive functionality

### 3. Authentication and Security Libraries

- **OAuth2 Libraries**: Implement standard OAuth2 flows
- **JWT Libraries**: Handle token-based authentication
- **Encryption Libraries**: Secure credential storage
- **Rate Limiting Libraries**: Implement API quota management

### 4. Workflow Orchestration

- **Temporal**: Consider for complex workflow orchestration
- **Bull/BullMQ**: For job queue management
- **Node-RED**: Study visual programming patterns
- **Apache Airflow**: Learn from DAG-based workflows

## Architectural Fit

### 1. Event System Integration

- Tool actions become first-class events alongside scripts and HTTP requests
- Leverage existing scheduling, retry, and monitoring infrastructure
- Integrate with current variable system for data flow
- Support both manual and scheduled execution

### 2. Plugin Architecture Enhancement

- Extend current plugin system with action definitions
- Maintain existing credential management patterns
- Add new UI components for action configuration
- Preserve template system for common action patterns

### 3. tRPC API Evolution

- Add new endpoints for tool action management
- Extend existing event endpoints to support tool actions
- Maintain type safety across frontend and backend
- Support schema validation for action parameters

### 4. Database Schema Evolution

- Extend events table to support tool action configuration
- Add new tables for action execution logs
- Maintain referential integrity with existing tables
- Support efficient querying for action history

## Success Metrics

### 1. Adoption Metrics

- Number of tool actions created vs. traditional scripts
- User engagement with tool action features
- Frequency of tool action execution
- Diversity of tools and actions used

### 2. Performance Metrics

- Tool action execution time and success rates
- System resource utilization
- API call efficiency and error rates
- User interface response times

### 3. Quality Metrics

- Reduction in configuration errors
- Improvement in user satisfaction scores
- Decrease in support tickets related to tool integrations
- Increase in complex workflow creation

## Next Steps

1. **Phase 1**: Core infrastructure development
   - Enhance plugin system with action definitions
   - Implement basic tool action event type
   - Create fundamental UI components

2. **Phase 2**: Tool integration expansion
   - Add support for 3-5 priority tools (Trello, Google Sheets, etc.)
   - Implement comprehensive error handling
   - Add execution monitoring and logging

3. **Phase 3**: Advanced features
   - Implement workflow integration
   - Add action templates and wizards
   - Enhance performance and scalability

4. **Phase 4**: Enterprise features
   - Add advanced security features
   - Implement rate limiting and quota management
   - Provide comprehensive analytics and reporting

This project represents a significant enhancement to Cronium's automation capabilities, positioning it as a comprehensive platform for both traditional scripting and modern tool integrations.
