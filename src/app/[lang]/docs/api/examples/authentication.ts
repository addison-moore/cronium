// Authentication code examples for API documentation

export const authenticationExamples = {
  usingApiKeys: {
    curl: `curl -H "Authorization: Bearer YOUR_API_TOKEN" \\
  https://your-cronium-instance.com/api/events`,
    python: `import requests

headers = {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
}

response = requests.get(
    'https://your-cronium-instance.com/api/events',
    headers=headers
)`,
    nodejs: `const axios = require('axios');

const client = axios.create({
  baseURL: 'https://your-cronium-instance.com/api',
  headers: {
    'Authorization': 'Bearer YOUR_API_TOKEN',
    'Content-Type': 'application/json'
  }
});

const response = await client.get('/events');`,
  },
};
