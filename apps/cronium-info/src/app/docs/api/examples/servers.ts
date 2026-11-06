// Servers API documentation. Credentials are write-only: no response contains an
// SSH key or password, only `hasPrivateKey` and `hasPassword`.

import { apiExample, type ApiEndpoint } from "./api-example";
import { responseExamples } from "./responses";

const serverId = {
  name: "id",
  in: "path",
  type: "integer",
  required: true,
  description: "Server ID.",
} as const;

export const serverEndpoints: readonly ApiEndpoint[] = [
  {
    method: "GET",
    path: "/api/servers",
    description: "List your servers and servers shared with you",
    scopes: ["full", "mcp"],
    status: 200,
    response: responseExamples.serverList,
    notes: "Returns every server as a JSON array. There is no paging.",
    example: apiExample({ method: "GET", path: "/api/servers" }),
  },
  {
    method: "POST",
    path: "/api/servers",
    description: "Add a server",
    scopes: ["full"],
    parameters: [
      {
        name: "name",
        in: "body",
        type: "string",
        required: true,
        description: "Display name.",
      },
      {
        name: "address",
        in: "body",
        type: "string",
        required: true,
        description: "Hostname or IP address.",
      },
      {
        name: "sshKey",
        in: "body",
        type: "string",
        required: true,
        description:
          "Private key, including its BEGIN and END lines. Cronium connects with it first and answers 400 if the connection fails.",
      },
      {
        name: "username",
        in: "body",
        type: "string",
        required: false,
        description: "SSH user. Defaults to root.",
      },
      {
        name: "port",
        in: "body",
        type: "number",
        required: false,
        description: "SSH port. Defaults to 22.",
      },
    ],
    status: 201,
    response: responseExamples.server,
    example: apiExample({
      method: "POST",
      path: "/api/servers",
      body: {
        name: "Production",
        address: "203.0.113.10",
        username: "deploy",
        port: 22,
        sshKey:
          "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----",
      },
    }),
  },
  {
    method: "GET",
    path: "/api/servers/{id}",
    description: "Get one server",
    scopes: ["full"],
    parameters: [serverId],
    status: 200,
    response: responseExamples.server,
    example: apiExample({ method: "GET", path: "/api/servers/7" }),
  },
  {
    method: "PUT",
    path: "/api/servers/{id}",
    description: "Update your server",
    scopes: ["full"],
    parameters: [
      serverId,
      {
        name: "name",
        in: "body",
        type: "string",
        required: false,
        description: "Display name.",
      },
      {
        name: "address",
        in: "body",
        type: "string",
        required: false,
        description:
          "Hostname or IP address. Changing the address or port clears the pinned SSH host key.",
      },
      {
        name: "sshKey",
        in: "body",
        type: "string",
        required: false,
        description:
          "New private key. Cronium connects with it first and answers 400 if the connection fails. Blank keeps the current key.",
      },
      {
        name: "username",
        in: "body",
        type: "string",
        required: false,
        description: "SSH user.",
      },
      {
        name: "port",
        in: "body",
        type: "number",
        required: false,
        description: "SSH port.",
      },
    ],
    status: 200,
    response: responseExamples.server,
    example: apiExample({
      method: "PUT",
      path: "/api/servers/7",
      body: { name: "Production (EU)", port: 2222 },
    }),
  },
  {
    method: "DELETE",
    path: "/api/servers/{id}",
    description: "Delete your server",
    scopes: ["full"],
    parameters: [serverId],
    status: 200,
    response: responseExamples.serverDeleted,
    notes:
      "An active script event that runs only on servers and has no other is paused, and a schedule incident on it says why. One that also runs locally becomes LOCAL and keeps running.",
    example: apiExample({ method: "DELETE", path: "/api/servers/7" }),
  },
];
