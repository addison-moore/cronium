// Builds the curl, Python and Node versions of a documented request from one
// definition, so they cannot drift apart and the contract test
// (apps/cronium-app/src/app/api/__tests__/documented-routes.test.ts) can send the
// documented request to the real route.

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequest {
  method: HttpMethod;
  /** Path on the instance, including any query string. */
  path: string;
  body?: Record<string, unknown>;
  /** The route answers with no body (a 204), so there is nothing to print. */
  noContent?: boolean;
}

export interface ApiExample {
  request: ApiRequest;
  curl: string;
  python: string;
  nodejs: string;
}

const BASE_URL = "https://cronium.example.com";
const AUTHORIZATION = "Bearer YOUR_API_TOKEN";

function curlExample({ method, path, body }: ApiRequest): string {
  const url = `${BASE_URL}${path}`;
  const args = [
    ...(method === "GET" ? [] : [`-X ${method}`]),
    `-H "Authorization: ${AUTHORIZATION}"`,
    ...(body
      ? [
          `-H "Content-Type: application/json"`,
          `-d '${JSON.stringify(body, null, 2)
            .replace(/'/g, `'\\''`)
            .replace(/\n/g, "\n  ")}'`,
        ]
      : []),
    url.includes("?") ? `"${url}"` : url,
  ];
  return `curl ${args.join(" \\\n  ")}`;
}

function pythonLiteral(value: unknown, indent: string): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  const inner = `${indent}    `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${inner}${pythonLiteral(v, inner)},`);
    return `[\n${items.join("\n")}\n${indent}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const items = entries.map(
      ([key, v]) =>
        `${inner}${JSON.stringify(key)}: ${pythonLiteral(v, inner)},`,
    );
    return `{\n${items.join("\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function pythonExample({ method, path, body, noContent }: ApiRequest): string {
  const args = [
    `"${BASE_URL}${path}"`,
    `headers={"Authorization": "${AUTHORIZATION}"}`,
    ...(body ? [`json=${pythonLiteral(body, "    ")}`] : []),
  ];
  return [
    "import requests",
    "",
    `response = requests.${method.toLowerCase()}(`,
    ...args.map((arg) => `    ${arg},`),
    ")",
    "response.raise_for_status()",
    ...(noContent ? [] : ["print(response.json())"]),
  ].join("\n");
}

function nodeExample({ method, path, body, noContent }: ApiRequest): string {
  const headers = body
    ? [
        "{",
        `      Authorization: "${AUTHORIZATION}",`,
        `      "Content-Type": "application/json",`,
        "    }",
      ].join("\n")
    : `{ Authorization: "${AUTHORIZATION}" }`;
  const options = [
    ...(method === "GET" ? [] : [`method: "${method}"`]),
    `headers: ${headers}`,
    ...(body
      ? [
          `body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, "\n    ")})`,
        ]
      : []),
  ];
  return [
    "const response = await fetch(",
    `  "${BASE_URL}${path}",`,
    "  {",
    ...options.map((option) => `    ${option},`),
    "  },",
    ");",
    "if (!response.ok) throw new Error(`HTTP ${response.status}`);",
    ...(noContent ? [] : ["console.log(await response.json());"]),
  ].join("\n");
}

export function apiExample(request: ApiRequest): ApiExample {
  return {
    request,
    curl: curlExample(request),
    python: pythonExample(request),
    nodejs: nodeExample(request),
  };
}

export type TokenScope = "full" | "mcp";

export interface ApiParameter {
  name: string;
  in: "path" | "query" | "body";
  type: string;
  required: boolean;
  description: string;
}

export interface ApiEndpoint {
  method: HttpMethod;
  /** The route, with `{id}`-style placeholders. */
  path: string;
  description: string;
  /** Token scopes this route accepts. The contract test holds this to the route. */
  scopes: readonly TokenScope[];
  parameters?: readonly ApiParameter[];
  /** Status of a successful call. */
  status: 200 | 201 | 202 | 204;
  /** Body of a successful call; absent for a 204. */
  response?: unknown;
  /** What the example's response is, when it needs saying. */
  notes?: string;
  example: ApiExample;
}
