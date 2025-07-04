// Workflows API code examples for API documentation

export const workflowsApiExamples = {
  listWorkflows: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  "https://your-cronium-instance.com/api/workflows?page=1&limit=10"`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}
params = {'page': 1, 'limit': 10, 'status': 'active'}

response = requests.get(
    'https://your-cronium-instance.com/api/workflows',
    headers=headers,
    params=params
)

workflows = response.json()['workflows']
for workflow in workflows:
    print(f"Workflow: {workflow['name']} - Status: {workflow['status']}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

const response = await client.get('/workflows', {
  params: { page: 1, limit: 10, status: 'active' }
});

const workflows = response.data.workflows;
workflows.forEach(workflow => {
  console.log(\`Workflow: \${workflow.name} - Status: \${workflow.status}\`);
});`,
  },
  createWorkflow: {
    curl: `curl -X POST \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Data Processing Pipeline",
    "description": "Automated data processing workflow",
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
    ]
  }' \\
  https://your-cronium-instance.com/api/workflows`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

workflow_data = {
    'name': 'Data Processing Pipeline',
    'description': 'Automated data processing workflow',
    'nodes': [
        {
            'id': 'node1',
            'type': 'event',
            'eventId': 1,
            'position': {'x': 100, 'y': 100}
        },
        {
            'id': 'node2',
            'type': 'event', 
            'eventId': 2,
            'position': {'x': 300, 'y': 100}
        }
    ],
    'edges': [
        {
            'id': 'edge1',
            'source': 'node1',
            'target': 'node2',
            'connectionType': 'ON_SUCCESS'
        }
    ]
}

response = requests.post(
    'https://your-cronium-instance.com/api/workflows',
    headers=headers,
    json=workflow_data
)

if response.status_code == 201:
    workflow = response.json()['workflow']
    print(f"Created workflow with ID: {workflow['id']}")
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

const workflowData = {
  name: 'Data Processing Pipeline',
  description: 'Automated data processing workflow',
  nodes: [
    {
      id: 'node1',
      type: 'event',
      eventId: 1,
      position: { x: 100, y: 100 }
    },
    {
      id: 'node2',
      type: 'event',
      eventId: 2, 
      position: { x: 300, y: 100 }
    }
  ],
  edges: [
    {
      id: 'edge1',
      source: 'node1',
      target: 'node2',
      connectionType: 'ON_SUCCESS'
    }
  ]
};

try {
  const response = await client.post('/workflows', workflowData);
  console.log(\`Created workflow with ID: \${response.data.workflow.id}\`);
} catch (error) {
  console.error('Error creating workflow:', error.response?.data || error.message);
}`,
  },
  getWorkflow: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  https://your-cronium-instance.com/api/workflows/456`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}

response = requests.get(
    'https://your-cronium-instance.com/api/workflows/456',
    headers=headers
)

if response.status_code == 200:
    workflow = response.json()['workflow']
    print(f"Workflow Name: {workflow['name']}")
    print(f"Nodes: {len(workflow['nodes'])}")
    print(f"Edges: {len(workflow['edges'])}")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

try {
  const response = await client.get('/workflows/456');
  const workflow = response.data.workflow;
  console.log(\`Workflow Name: \${workflow.name}\`);
  console.log(\`Nodes: \${workflow.nodes.length}\`);
  console.log(\`Edges: \${workflow.edges.length}\`);
} catch (error) {
  console.error('Error fetching workflow:', error.response?.data || error.message);
}`,
  },
  updateWorkflow: {
    curl: `curl -X PUT \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Updated Workflow Name",
    "description": "Updated description",
    "status": "paused"
  }' \\
  https://your-cronium-instance.com/api/workflows/456`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

data = {
    'name': 'Updated Workflow Name',
    'description': 'Updated description',
    'status': 'paused'
}

response = requests.put(
    'https://your-cronium-instance.com/api/workflows/456',
    headers=headers,
    json=data
)

if response.status_code == 200:
    workflow = response.json()['workflow']
    print(f"Updated workflow: {workflow['name']}")
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
  name: 'Updated Workflow Name',
  description: 'Updated description',
  status: 'paused'
};

try {
  const response = await client.put('/workflows/456', updateData);
  console.log(\`Updated workflow: \${response.data.workflow.name}\`);
} catch (error) {
  console.error('Error updating workflow:', error.response?.data || error.message);
}`,
  },
  executeWorkflow: {
    curl: `curl -X POST \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"input": {"startParam": "initialValue"}}' \\
  https://your-cronium-instance.com/api/workflows/456/execute`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

# Optional input data for the workflow
input_data = {
    'input': {
        'startParam': 'initialValue',
        'config': {
            'debug': True,
            'timeout': 300
        }
    }
}

response = requests.post(
    'https://your-cronium-instance.com/api/workflows/456/execute',
    headers=headers,
    json=input_data
)

if response.status_code == 200:
    execution = response.json()['execution']
    print(f"Workflow execution started with ID: {execution['id']}")
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

// Optional input data for the workflow
const inputData = {
  input: {
    startParam: 'initialValue',
    config: {
      debug: true,
      timeout: 300
    }
  }
};

try {
  const response = await client.post('/workflows/456/execute', inputData);
  const execution = response.data.execution;
  console.log(\`Workflow execution started with ID: \${execution.id}\`);
  console.log(\`Status: \${execution.status}\`);
} catch (error) {
  console.error('Error executing workflow:', error.response?.data || error.message);
}`,
  },
};