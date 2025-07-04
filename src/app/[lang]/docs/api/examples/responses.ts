// Response formats and error handling examples for API documentation

export const responseExamples = {
  // Standard success responses
  listEventsResponse: `{
  "events": [
    {
      "id": 1,
      "name": "Daily Backup",
      "description": "Automated database backup",
      "type": "BASH",
      "status": "active",
      "schedule": "0 2 * * *",
      "createdAt": "2024-01-15T10:30:00Z",
      "lastRun": "2024-01-20T02:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "pages": 3
  }
}`,

  createEventResponse: `{
  "event": {
    "id": 42,
    "name": "New Event",
    "description": "Event created via API",
    "type": "BASH",
    "status": "active",
    "createdAt": "2024-01-20T15:30:00Z"
  }
}`,

  getEventResponse: `{
  "event": {
    "id": 123,
    "name": "Data Processing",
    "description": "Process daily data files",
    "type": "PYTHON",
    "status": "active",
    "schedule": "0 6 * * *",
    "script": "import pandas as pd\\ndf = pd.read_csv('data.csv')\\ndf.to_json('output.json')",
    "serverId": 1,
    "maxExecutions": null,
    "executionCount": 15,
    "createdAt": "2024-01-10T08:00:00Z",
    "updatedAt": "2024-01-20T14:30:00Z",
    "lastRun": "2024-01-20T06:00:00Z",
    "nextRun": "2024-01-21T06:00:00Z"
  }
}`,

  executeEventResponse: `{
  "execution": {
    "id": "exec_456789",
    "eventId": 123,
    "status": "running",
    "startedAt": "2024-01-20T15:45:00Z",
    "input": {
      "param1": "value1",
      "param2": "value2"
    }
  }
}`,

  eventLogsResponse: `{
  "logs": [
    {
      "id": 1001,
      "eventId": 123,
      "executedAt": "2024-01-20T06:00:00Z",
      "success": true,
      "output": "Data processing completed successfully. Processed 1,234 records.",
      "errorMessage": null,
      "executionTime": 45.2,
      "serverId": 1
    },
    {
      "id": 1000,
      "eventId": 123,
      "executedAt": "2024-01-19T06:00:00Z", 
      "success": false,
      "output": "Error: File not found",
      "errorMessage": "FileNotFoundError: [Errno 2] No such file or directory: 'data.csv'",
      "executionTime": 2.1,
      "serverId": 1
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "pages": 5
  }
}`,

  listWorkflowsResponse: `{
  "workflows": [
    {
      "id": 456,
      "name": "Data Pipeline",
      "description": "Complete data processing pipeline",
      "status": "active",
      "schedule": "0 3 * * *",
      "nodes": [
        {
          "id": "node1",
          "type": "event",
          "eventId": 1,
          "position": {"x": 100, "y": 100}
        },
        {
          "id": "node2",
          "type": "event",
          "eventId": 2,
          "position": {"x": 300, "y": 100}
        }
      ],
      "edges": [
        {
          "id": "edge1",
          "source": "node1",
          "target": "node2",
          "connectionType": "ON_SUCCESS"
        }
      ],
      "createdAt": "2024-01-12T09:00:00Z",
      "lastRun": "2024-01-20T03:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 8,
    "pages": 1
  }
}`,

  executeWorkflowResponse: `{
  "execution": {
    "id": "wf_exec_789012",
    "workflowId": 456,
    "status": "running",
    "startedAt": "2024-01-20T16:00:00Z",
    "input": {
      "startParam": "initialValue"
    },
    "progress": {
      "completedNodes": 0,
      "totalNodes": 3,
      "currentNode": "node1"
    }
  }
}`,

  listServersResponse: `{
  "servers": [
    {
      "id": 789,
      "name": "Production Server",
      "address": "192.168.1.100",
      "port": 22,
      "username": "deploy",
      "status": "online",
      "lastHealthCheck": "2024-01-20T15:30:00Z",
      "createdAt": "2024-01-05T12:00:00Z"
    },
    {
      "id": 790,
      "name": "Staging Server", 
      "address": "192.168.1.101",
      "port": 22,
      "username": "staging",
      "status": "offline",
      "lastHealthCheck": "2024-01-20T15:25:00Z",
      "createdAt": "2024-01-05T12:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "pages": 1
  }
}`,

  listVariablesResponse: `{
  "variables": [
    {
      "id": 1,
      "key": "DATABASE_URL",
      "value": "postgresql://user:password@localhost:5432/mydb",
      "description": "Production database connection string",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-20T14:15:00Z"
    },
    {
      "id": 2,
      "key": "API_SECRET_KEY",
      "value": "sk-1234567890abcdef",
      "description": "Secret key for external API authentication",
      "createdAt": "2024-01-16T09:15:00Z",
      "updatedAt": "2024-01-16T09:15:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 2,
    "total": 2,
    "pages": 1
  }
}`,

  createVariableResponse: `{
  "variable": {
    "id": 3,
    "key": "DATABASE_URL",
    "value": "postgresql://user:password@localhost:5432/mydb",
    "description": "Production database connection string",
    "createdAt": "2024-01-20T16:00:00Z",
    "updatedAt": "2024-01-20T16:00:00Z"
  }
}`,

  getVariableResponse: `{
  "variable": {
    "id": 1,
    "key": "DATABASE_URL",
    "value": "postgresql://user:password@localhost:5432/mydb",
    "description": "Production database connection string",
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-20T14:15:00Z"
  }
}`,

  serverConnectionTestResponse: `{
  "success": true,
  "message": "Connection successful. Server: Ubuntu 20.04.6 LTS, Uptime: 45 days"
}`,

  // Error response examples
  unauthorizedError: `{
  "error": "Unauthorized",
  "message": "Invalid or missing API token",
  "code": 401,
  "timestamp": "2024-01-20T16:15:00Z"
}`,

  forbiddenError: `{
  "error": "Forbidden", 
  "message": "Insufficient permissions to access this resource",
  "code": 403,
  "timestamp": "2024-01-20T16:15:00Z"
}`,

  notFoundError: `{
  "error": "Not Found",
  "message": "Event with ID 999 not found",
  "code": 404,
  "timestamp": "2024-01-20T16:15:00Z"
}`,

  validationError: `{
  "error": "Validation Error",
  "message": "Invalid request data",
  "code": 400,
  "details": [
    {
      "field": "name",
      "message": "Name is required"
    },
    {
      "field": "type", 
      "message": "Type must be one of: BASH, PYTHON, NODEJS, HTTP_REQUEST"
    }
  ],
  "timestamp": "2024-01-20T16:15:00Z"
}`,

  rateLimitError: `{
  "error": "Rate Limit Exceeded",
  "message": "Too many requests. Rate limit: 100 requests per minute",
  "code": 429,
  "retryAfter": 60,
  "timestamp": "2024-01-20T16:15:00Z"
}`,

  serverError: `{
  "error": "Internal Server Error",
  "message": "An unexpected error occurred",
  "code": 500,
  "requestId": "req_abc123def456",
  "timestamp": "2024-01-20T16:15:00Z"
}`,
};

export const errorHandlingExamples = {
  pythonErrorHandling: `import requests
from requests.exceptions import RequestException, HTTPError, Timeout

def make_api_request(url, headers, data=None):
    try:
        response = requests.post(url, headers=headers, json=data, timeout=30)
        response.raise_for_status()  # Raises HTTPError for bad responses
        return response.json()
    
    except HTTPError as e:
        if e.response.status_code == 401:
            print("Error: Invalid API token")
        elif e.response.status_code == 403:
            print("Error: Insufficient permissions")
        elif e.response.status_code == 404:
            print("Error: Resource not found")
        elif e.response.status_code == 429:
            print("Error: Rate limit exceeded")
            retry_after = e.response.headers.get('Retry-After', 60)
            print(f"Retry after {retry_after} seconds")
        else:
            print(f"HTTP Error: {e.response.status_code} - {e.response.text}")
    
    except Timeout:
        print("Error: Request timeout")
    
    except RequestException as e:
        print(f"Request Error: {str(e)}")
    
    except Exception as e:
        print(f"Unexpected Error: {str(e)}")
    
    return None

# Usage example
headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}
result = make_api_request('https://your-cronium-instance.com/api/events', headers)`,

  nodejsErrorHandling: `const axios = require('axios');

class CroniumAPIClient {
  constructor(baseURL, apiToken) {
    this.client = axios.create({
      baseURL,
      headers: {
        'Authorization': \`Bearer \${apiToken}\`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      error => {
        if (error.response) {
          // Server responded with error status
          const { status, data } = error.response;
          
          switch (status) {
            case 401:
              console.error('Error: Invalid API token');
              break;
            case 403:
              console.error('Error: Insufficient permissions');
              break;
            case 404:
              console.error('Error: Resource not found');
              break;
            case 429:
              console.error('Error: Rate limit exceeded');
              const retryAfter = error.response.headers['retry-after'] || 60;
              console.error(\`Retry after \${retryAfter} seconds\`);
              break;
            default:
              console.error(\`HTTP Error: \${status} - \${data.message || data}\`);
          }
        } else if (error.request) {
          // Request made but no response received
          console.error('Error: No response from server');
        } else {
          // Something else happened
          console.error('Error:', error.message);
        }
        
        throw error;
      }
    );
  }

  async createEvent(eventData) {
    try {
      const response = await this.client.post('/events', eventData);
      return response.data;
    } catch (error) {
      // Error already logged by interceptor
      return null;
    }
  }
}

// Usage example
const api = new CroniumAPIClient('https://your-cronium-instance.com/api', 'YOUR_API_TOKEN');
const result = await api.createEvent({ name: 'Test Event', type: 'BASH' });`,

  curlErrorHandling: `#!/bin/bash

# Function to make API requests with error handling
make_api_request() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local api_token="YOUR_API_TOKEN"
    local base_url="https://your-cronium-instance.com/api"
    
    # Make the request and capture both response and HTTP status
    local response
    local http_status
    
    if [ -n "$data" ]; then
        response=$(curl -s -w "\\n%{http_code}" \\
            -X "$method" \\
            -H "Authorization: Bearer $api_token" \\
            -H "Content-Type: application/json" \\
            -d "$data" \\
            "$base_url$endpoint")
    else
        response=$(curl -s -w "\\n%{http_code}" \\
            -H "Authorization: Bearer $api_token" \\
            "$base_url$endpoint")
    fi
    
    # Extract HTTP status code (last line)
    http_status=$(echo "$response" | tail -n1)
    # Extract response body (all but last line)
    response_body=$(echo "$response" | head -n -1)
    
    # Handle different HTTP status codes
    case $http_status in
        200|201)
            echo "Success: $response_body"
            return 0
            ;;
        401)
            echo "Error: Invalid API token"
            return 1
            ;;
        403)
            echo "Error: Insufficient permissions"
            return 1
            ;;
        404)
            echo "Error: Resource not found"
            return 1
            ;;
        429)
            echo "Error: Rate limit exceeded"
            # Extract retry-after header if available
            retry_after=$(echo "$response" | grep -i "retry-after" | cut -d: -f2 | tr -d ' ')
            echo "Retry after \${retry_after:-60} seconds"
            return 1
            ;;
        *)
            echo "HTTP Error: $http_status - $response_body"
            return 1
            ;;
    esac
}

# Usage examples
make_api_request "GET" "/events"
make_api_request "POST" "/events" '{"name": "Test Event", "type": "BASH", "script": "echo Hello"}'`,
};
