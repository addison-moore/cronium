// Events API code examples for API documentation

export const eventsApiExamples = {
  listEvents: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  "https://your-cronium-instance.com/api/events?page=1&limit=10"`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}
params = {'page': 1, 'limit': 10, 'status': 'active'}

response = requests.get(
    'https://your-cronium-instance.com/api/events',
    headers=headers,
    params=params
)

events = response.json()['events']
for event in events:
    print(f"Event: {event['name']} - Status: {event['status']}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

const response = await client.get('/events', {
  params: { page: 1, limit: 10, status: 'active' }
});

const events = response.data.events;
events.forEach(event => {
  console.log(\`Event: \${event.name} - Status: \${event.status}\`);
});`,
  },
  createEvent: {
    curl: `curl -X POST \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "API Created Event",
    "description": "Event created via API",
    "type": "BASH",
    "script": "echo \\"Hello from API\\"",
    "schedule": "0 9 * * MON"
  }' \\
  https://your-cronium-instance.com/api/events`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

data = {
    'name': 'API Created Event',
    'description': 'Event created via API',
    'type': 'PYTHON',
    'script': 'print("Hello from API")',
    'schedule': '0 9 * * MON'
}

response = requests.post(
    'https://your-cronium-instance.com/api/events',
    headers=headers,
    json=data
)

if response.status_code == 201:
    event = response.json()['event']
    print(f"Created event with ID: {event['id']}")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
  }
});

const eventData = {
  name: 'API Created Event',
  description: 'Event created via API',
  type: 'NODEJS',
  script: 'console.log("Hello from API");',
  schedule: '0 9 * * MON'
};

try {
  const response = await client.post('/events', eventData);
  console.log(\`Created event with ID: \${response.data.event.id}\`);
} catch (error) {
  console.error('Error creating event:', error.response?.data || error.message);
}`,
  },
  getEvent: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  https://your-cronium-instance.com/api/events/123`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}

response = requests.get(
    'https://your-cronium-instance.com/api/events/123',
    headers=headers
)

if response.status_code == 200:
    event = response.json()['event']
    print(f"Event Name: {event['name']}")
    print(f"Type: {event['type']}")
    print(f"Status: {event['status']}")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

try {
  const response = await client.get('/events/123');
  const event = response.data.event;
  console.log(\`Event Name: \${event.name}\`);
  console.log(\`Type: \${event.type}\`);
  console.log(\`Status: \${event.status}\`);
} catch (error) {
  console.error('Error fetching event:', error.response?.data || error.message);
}`,
  },
  updateEvent: {
    curl: `curl -X PUT \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Updated Event Name",
    "description": "Updated description",
    "status": "paused"
  }' \\
  https://your-cronium-instance.com/api/events/123`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

data = {
    'name': 'Updated Event Name',
    'description': 'Updated description',
    'status': 'paused'
}

response = requests.put(
    'https://your-cronium-instance.com/api/events/123',
    headers=headers,
    json=data
)

if response.status_code == 200:
    event = response.json()['event']
    print(f"Updated event: {event['name']}")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
  }
});

const updateData = {
  name: 'Updated Event Name',
  description: 'Updated description',
  status: 'paused'
};

try {
  const response = await client.put('/events/123', updateData);
  console.log(\`Updated event: \${response.data.event.name}\`);
} catch (error) {
  console.error('Error updating event:', error.response?.data || error.message);
}`,
  },
  deleteEvent: {
    curl: `curl -X DELETE \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  https://your-cronium-instance.com/api/events/123`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}

response = requests.delete(
    'https://your-cronium-instance.com/api/events/123',
    headers=headers
)

if response.status_code == 200:
    print("Event deleted successfully")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

try {
  await client.delete('/events/123');
  console.log('Event deleted successfully');
} catch (error) {
  console.error('Error deleting event:', error.response?.data || error.message);
}`,
  },
  executeEvent: {
    curl: `curl -X POST \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"input": {"param1": "value1", "param2": "value2"}}' \\
  https://your-cronium-instance.com/api/events/123/execute`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

# Optional input data for the event
input_data = {
    'input': {
        'param1': 'value1',
        'param2': 'value2'
    }
}

response = requests.post(
    'https://your-cronium-instance.com/api/events/123/execute',
    headers=headers,
    json=input_data
)

if response.status_code == 200:
    execution = response.json()['execution']
    print(f"Execution started with ID: {execution['id']}")
    print(f"Status: {execution['status']}")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
  }
});

// Optional input data for the event
const inputData = {
  input: {
    param1: 'value1',
    param2: 'value2'
  }
};

try {
  const response = await client.post('/events/123/execute', inputData);
  const execution = response.data.execution;
  console.log(\`Execution started with ID: \${execution.id}\`);
  console.log(\`Status: \${execution.status}\`);
} catch (error) {
  console.error('Error executing event:', error.response?.data || error.message);
}`,
  },
  getEventLogs: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  "https://your-cronium-instance.com/api/events/123/logs?page=1&limit=10"`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}
params = {'page': 1, 'limit': 10}

response = requests.get(
    'https://your-cronium-instance.com/api/events/123/logs',
    headers=headers,
    params=params
)

if response.status_code == 200:
    logs = response.json()['logs']
    for log in logs:
        status = "✓" if log['success'] else "✗"
        print(f"{status} {log['executedAt']}: {log['output'][:100]}...")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

try {
  const response = await client.get('/events/123/logs', {
    params: { page: 1, limit: 10 }
  });
  
  const logs = response.data.logs;
  logs.forEach(log => {
    const status = log.success ? '✓' : '✗';
    console.log(\`\${status} \${log.executedAt}: \${log.output.substring(0, 100)}...\`);
  });
} catch (error) {
  console.error('Error fetching logs:', error.response?.data || error.message);
}`,
  },
};