// Servers API code examples for API documentation

export const serversApiExamples = {
  listServers: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  "https://your-cronium-instance.com/api/servers?page=1&limit=10"`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}
params = {'page': 1, 'limit': 10}

response = requests.get(
    'https://your-cronium-instance.com/api/servers',
    headers=headers,
    params=params
)

servers = response.json()['servers']
for server in servers:
    print(f"Server: {server['name']} - Status: {server['status']}")
    print(f"Address: {server['address']}:{server['port']}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

const response = await client.get('/servers', {
  params: { page: 1, limit: 10 }
});

const servers = response.data.servers;
servers.forEach(server => {
  console.log(\`Server: \${server.name} - Status: \${server.status}\`);
  console.log(\`Address: \${server.address}:\${server.port}\`);
});`,
  },
  createServer: {
    curl: `curl -X POST \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Production Server",
    "address": "192.168.1.100",
    "port": 22,
    "username": "deploy",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\\n...\\n-----END OPENSSH PRIVATE KEY-----"
  }' \\
  https://your-cronium-instance.com/api/servers`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

# Read SSH private key from file
with open('private_key.pem', 'r') as f:
    ssh_key = f.read()

server_data = {
    'name': 'Production Server',
    'address': '192.168.1.100',
    'port': 22,
    'username': 'deploy',
    'sshKey': ssh_key
}

response = requests.post(
    'https://your-cronium-instance.com/api/servers',
    headers=headers,
    json=server_data
)

if response.status_code == 201:
    server = response.json()['server']
    print(f"Created server with ID: {server['id']}")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');
const fs = require('fs');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
  }
});

// Read SSH private key from file
const sshKey = fs.readFileSync('private_key.pem', 'utf8');

const serverData = {
  name: 'Production Server',
  address: '192.168.1.100',
  port: 22,
  username: 'deploy',
  sshKey: sshKey
};

try {
  const response = await client.post('/servers', serverData);
  console.log(\`Created server with ID: \${response.data.server.id}\`);
} catch (error) {
  console.error('Error creating server:', error.response?.data || error.message);
}`,
  },
  getServer: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  https://your-cronium-instance.com/api/servers/789`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}

response = requests.get(
    'https://your-cronium-instance.com/api/servers/789',
    headers=headers
)

if response.status_code == 200:
    server = response.json()['server']
    print(f"Server Name: {server['name']}")
    print(f"Address: {server['address']}:{server['port']}")
    print(f"Username: {server['username']}")
    print(f"Status: {server['status']}")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

try {
  const response = await client.get('/servers/789');
  const server = response.data.server;
  console.log(\`Server Name: \${server.name}\`);
  console.log(\`Address: \${server.address}:\${server.port}\`);
  console.log(\`Username: \${server.username}\`);
  console.log(\`Status: \${server.status}\`);
} catch (error) {
  console.error('Error fetching server:', error.response?.data || error.message);
}`,
  },
  testServerConnection: {
    curl: `curl -X POST \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  https://your-cronium-instance.com/api/servers/789/test`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}

response = requests.post(
    'https://your-cronium-instance.com/api/servers/789/test',
    headers=headers
)

if response.status_code == 200:
    result = response.json()
    if result['success']:
        print("✓ Connection successful")
        print(f"Server info: {result['message']}")
    else:
        print("✗ Connection failed")
        print(f"Error: {result['message']}")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

try {
  const response = await client.post('/servers/789/test');
  const result = response.data;
  
  if (result.success) {
    console.log('✓ Connection successful');
    console.log(\`Server info: \${result.message}\`);
  } else {
    console.log('✗ Connection failed');
    console.log(\`Error: \${result.message}\`);
  }
} catch (error) {
  console.error('Error testing connection:', error.response?.data || error.message);
}`,
  },
  updateServer: {
    curl: `curl -X PUT \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Updated Server Name",
    "address": "192.168.1.101",
    "port": 2222
  }' \\
  https://your-cronium-instance.com/api/servers/789`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

data = {
    'name': 'Updated Server Name',
    'address': '192.168.1.101',
    'port': 2222
}

response = requests.put(
    'https://your-cronium-instance.com/api/servers/789',
    headers=headers,
    json=data
)

if response.status_code == 200:
    server = response.json()['server']
    print(f"Updated server: {server['name']}")
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
  name: 'Updated Server Name',
  address: '192.168.1.101',
  port: 2222
};

try {
  const response = await client.put('/servers/789', updateData);
  console.log(\`Updated server: \${response.data.server.name}\`);
} catch (error) {
  console.error('Error updating server:', error.response?.data || error.message);
}`,
  },
  deleteServer: {
    curl: `curl -X DELETE \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  https://your-cronium-instance.com/api/servers/789`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}

response = requests.delete(
    'https://your-cronium-instance.com/api/servers/789',
    headers=headers
)

if response.status_code == 200:
    print("Server deleted successfully")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

try {
  await client.delete('/servers/789');
  console.log('Server deleted successfully');
} catch (error) {
  console.error('Error deleting server:', error.response?.data || error.message);
}`,
  },
};