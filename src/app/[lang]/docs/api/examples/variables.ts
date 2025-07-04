// Variables API code examples for API documentation

export const variablesApiExamples = {
  listVariables: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  "https://your-cronium-instance.com/api/variables"`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}

response = requests.get(
    'https://your-cronium-instance.com/api/variables',
    headers=headers
)

variables = response.json()['variables']
for variable in variables:
    print(f"Variable: {variable['key']} = {variable['value']}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

const response = await client.get('/variables');
const variables = response.data.variables;
variables.forEach(variable => {
  console.log(\`Variable: \${variable.key} = \${variable.value}\`);
});`,
  },
  createVariable: {
    curl: `curl -X POST \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "key": "DATABASE_URL",
    "value": "postgresql://user:password@localhost:5432/mydb",
    "description": "Production database connection string"
  }' \\
  https://your-cronium-instance.com/api/variables`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

data = {
    'key': 'DATABASE_URL',
    'value': 'postgresql://user:password@localhost:5432/mydb',
    'description': 'Production database connection string'
}

response = requests.post(
    'https://your-cronium-instance.com/api/variables',
    headers=headers,
    json=data
)

if response.status_code == 201:
    variable = response.json()['variable']
    print(f"Created variable: {variable['key']}")
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

const variableData = {
  key: 'DATABASE_URL',
  value: 'postgresql://user:password@localhost:5432/mydb',
  description: 'Production database connection string'
};

try {
  const response = await client.post('/variables', variableData);
  console.log(\`Created variable: \${response.data.variable.key}\`);
} catch (error) {
  console.error('Error creating variable:', error.response?.data || error.message);
}`,
  },
  getVariable: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  https://your-cronium-instance.com/api/variables/DATABASE_URL`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}

response = requests.get(
    'https://your-cronium-instance.com/api/variables/DATABASE_URL',
    headers=headers
)

if response.status_code == 200:
    variable = response.json()['variable']
    print(f"Variable: {variable['key']}")
    print(f"Value: {variable['value']}")
    print(f"Description: {variable['description']}")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

try {
  const response = await client.get('/variables/DATABASE_URL');
  const variable = response.data.variable;
  console.log(\`Variable: \${variable.key}\`);
  console.log(\`Value: \${variable.value}\`);
  console.log(\`Description: \${variable.description}\`);
} catch (error) {
  console.error('Error fetching variable:', error.response?.data || error.message);
}`,
  },
  updateVariable: {
    curl: `curl -X PUT \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "value": "postgresql://user:newpassword@localhost:5432/mydb",
    "description": "Updated production database connection string"
  }' \\
  https://your-cronium-instance.com/api/variables/DATABASE_URL`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

data = {
    'value': 'postgresql://user:newpassword@localhost:5432/mydb',
    'description': 'Updated production database connection string'
}

response = requests.put(
    'https://your-cronium-instance.com/api/variables/DATABASE_URL',
    headers=headers,
    json=data
)

if response.status_code == 200:
    variable = response.json()['variable']
    print(f"Updated variable: {variable['key']}")
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
  value: 'postgresql://user:newpassword@localhost:5432/mydb',
  description: 'Updated production database connection string'
};

try {
  const response = await client.put('/variables/DATABASE_URL', updateData);
  console.log(\`Updated variable: \${response.data.variable.key}\`);
} catch (error) {
  console.error('Error updating variable:', error.response?.data || error.message);
}`,
  },
  deleteVariable: {
    curl: `curl -X DELETE \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  https://your-cronium-instance.com/api/variables/DATABASE_URL`,
    python: `import requests

headers = {'Authorization': 'Bearer YOUR_API_TOKEN'}

response = requests.delete(
    'https://your-cronium-instance.com/api/variables/DATABASE_URL',
    headers=headers
)

if response.status_code == 200:
    print("Variable deleted successfully")
else:
    print(f"Error: {response.status_code} - {response.text}")`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: { 'Authorization': 'Bearer YOUR_API_TOKEN' }
});

try {
  await client.delete('/variables/DATABASE_URL');
  console.log('Variable deleted successfully');
} catch (error) {
  console.error('Error deleting variable:', error.response?.data || error.message);
}`,
  },
};
