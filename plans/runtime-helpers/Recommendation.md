# Runtime Helpers Redesign Recommendation (Revised)

## Executive Summary

Since Cronium has no production users and we're free to make breaking changes, we should take this opportunity to implement a **clean, modern runtime helper system** from the ground up. Rather than maintaining backward compatibility with the file-based system, we should build the API-based approach directly and provide migration scripts for test data.

## Core Recommendation: API-First Architecture

### 1. Eliminate File-Based Helpers Completely

**Decision**: Remove all file-based communication immediately and implement only the HTTP-based Runtime API.

**Rationale**:

- No users to impact
- File-based system has fundamental security flaws
- Maintaining dual systems adds unnecessary complexity
- Clean architecture from day one

**Implementation**:

```typescript
// Single, clean implementation
interface RuntimeAPI {
  // Core operations
  getInput(): Promise<any>;
  setOutput(data: any): Promise<void>;
  getVariable(key: string): Promise<any>;
  setVariable(key: string, value: any): Promise<void>;

  // Workflow control
  setCondition(condition: boolean): Promise<void>;
  getCondition(): Promise<boolean>;

  // Metadata
  getEventContext(): Promise<EventContext>;

  // Advanced features (implement from start)
  streamInput(): AsyncIterator<any>;
  streamOutput(): WritableStream;
  executeToolAction(config: ToolActionConfig): Promise<any>;
}
```

### 2. Simple but Secure Architecture

**Runtime Service Design**:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Container     │────▶│ Runtime Service │────▶│   Backend API   │
│   (Script)      │     │   (Sidecar)     │     │   (Storage)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                                  │
        └──────────── Execution Token ────────────────────┘
```

**Security Model**:

- Simple JWT tokens with execution scope
- Local network isolation for container-sidecar
- Token injection via environment variables
- No complex mTLS or certificate management

### 3. Unified Runtime Helper Implementation

**Single SDK Per Language**:

```python
# Python - cronium.py
import os
import requests
from typing import Any

class Cronium:
    def __init__(self):
        self.api_url = os.environ['CRONIUM_RUNTIME_API']
        self.token = os.environ['CRONIUM_EXECUTION_TOKEN']
        self.headers = {'Authorization': f'Bearer {self.token}'}

    def input(self) -> Any:
        return self._get('/input')

    def output(self, data: Any) -> None:
        self._post('/output', data)

    def get_variable(self, key: str) -> Any:
        return self._get(f'/variables/{key}')

    def set_variable(self, key: str, value: Any) -> None:
        self._put(f'/variables/{key}', value)

    def execute_tool_action(self, config: dict) -> Any:
        return self._post('/tool-actions/execute', config)

    # Helper methods
    def _get(self, path: str) -> Any:
        response = requests.get(
            f"{self.api_url}{path}",
            headers=self.headers
        )
        response.raise_for_status()
        return response.json()

    def _post(self, path: str, data: Any) -> Any:
        response = requests.post(
            f"{self.api_url}{path}",
            json=data,
            headers=self.headers
        )
        response.raise_for_status()
        return response.json() if response.content else None

    def _put(self, path: str, data: Any) -> None:
        response = requests.put(
            f"{self.api_url}{path}",
            json=data,
            headers=self.headers
        )
        response.raise_for_status()

# Global instance
cronium = Cronium()
```

### 4. Migration Strategy for Test Data

**Automated Migration Script**:

```typescript
// migrate-events.ts
async function migrateEvents() {
  const events = await db.select().from(eventsTable);

  for (const event of events) {
    // Update script content to remove file-based imports
    if (event.type === "SCRIPT") {
      const migrated = migrateScriptContent(
        event.scriptContent,
        event.language,
      );

      await db
        .update(eventsTable)
        .set({ scriptContent: migrated })
        .where(eq(eventsTable.id, event.id));
    }
  }
}

function migrateScriptContent(content: string, language: string): string {
  // Remove old file-based imports
  const patterns = {
    javascript: /const cronium = require\('\.\/cronium\.js'\);?/g,
    python: /import json\nimport os\n.*cronium\.py.*/g,
    bash: /source \.\/cronium\.sh/g,
  };

  // New imports are automatic via container environment
  return content.replace(patterns[language], "");
}
```

### 5. Container Execution Environment

**Base Container Images**:

```dockerfile
# cronium/python:latest
FROM python:3.11-slim
RUN pip install requests
COPY runtime-helpers/cronium.py /usr/local/lib/python3.11/site-packages/
ENV PYTHONPATH=/usr/local/lib/python3.11/site-packages

# cronium/node:latest
FROM node:20-slim
COPY runtime-helpers/cronium.js /usr/local/lib/
ENV NODE_PATH=/usr/local/lib

# cronium/bash:latest
FROM alpine:latest
RUN apk add --no-cache bash curl jq
COPY runtime-helpers/cronium.sh /usr/local/bin/
```

### 6. Runtime Service Implementation

**Lightweight Go Service**:

```go
// Simple runtime service that runs as sidecar
type RuntimeService struct {
    backend    BackendClient
    cache      map[string]interface{}
    executionID string
}

func (s *RuntimeService) GetVariable(key string) (interface{}, error) {
    // Check cache first
    if val, ok := s.cache[key]; ok {
        return val, nil
    }

    // Fetch from backend
    val, err := s.backend.GetVariable(s.executionID, key)
    if err != nil {
        return nil, err
    }

    // Cache for this execution
    s.cache[key] = val
    return val, nil
}
```

### 7. SSH Execution Approach

**Direct API Access**:

- Inject `CRONIUM_RUNTIME_API` pointing to public backend URL
- Use same runtime helpers as containers
- No file fallback, no special handling
- Tool Actions work identically (API proxy)

### 8. Enhanced Features from Day One

Since we're building fresh, include these features immediately:

**A. Streaming Support**:

```python
# Built into runtime helpers
async for chunk in cronium.stream_input():
    processed = transform(chunk)
    await cronium.stream_output(processed)
```

**B. Type Safety**:

```typescript
// TypeScript definitions included
interface CroniumVariable<T = any> {
  get(): Promise<T>;
  set(value: T): Promise<void>;
  subscribe(callback: (value: T) => void): () => void;
}
```

**C. Tool Action Integration**:

```javascript
// Direct tool execution from scripts
const result = await cronium.executeToolAction({
  tool: "slack",
  action: "send-message",
  params: { channel: "#alerts", text: message },
});
```

## Implementation Plan

### Week 1: Core Runtime Service

1. Build Go runtime service with basic endpoints
2. Implement execution token validation
3. Add caching layer for variables
4. Create health check endpoints

### Week 2: Runtime Helpers

1. Implement Python SDK with all features
2. Implement Node.js SDK with all features
3. Implement Bash helpers with all features
4. Create comprehensive tests

### Week 3: Container Integration

1. Build base container images
2. Update orchestrator to inject sidecar
3. Configure networking between containers
4. Test all execution scenarios

### Week 4: Migration & Cleanup

1. Write migration script for test events
2. Remove all file-based code
3. Update documentation
4. Performance testing

## Benefits of This Approach

1. **Clean Architecture**: No legacy code or compatibility layers
2. **Better Security**: API-based from the start
3. **Simpler Codebase**: One implementation to maintain
4. **Modern Features**: Streaming, type safety, tool integration
5. **Easier Testing**: Mock API instead of file system
6. **Better Performance**: Caching and optimizations built-in

## Risks and Mitigation

| Risk                   | Impact                 | Mitigation                        |
| ---------------------- | ---------------------- | --------------------------------- |
| Migration script fails | Test events broken     | Manual review and fixes           |
| API latency            | Slower execution       | Local caching, connection pooling |
| Complex debugging      | Harder troubleshooting | Comprehensive logging, trace IDs  |
| Learning curve         | Contribution barrier   | Excellent documentation, examples |

## Conclusion

By taking advantage of our position (no production users), we can build a modern, secure runtime helper system without the burden of backward compatibility. This approach:

- Eliminates all file-based security vulnerabilities
- Provides a clean, consistent API across all languages
- Enables advanced features like streaming and tool integration
- Simplifies the codebase significantly
- Sets Cronium up for long-term success

The temporary inconvenience of migrating test events is far outweighed by the benefits of starting fresh with a properly designed system. This is our opportunity to build it right from the beginning.
