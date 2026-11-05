// The two routes CI needs: start a run, then optionally wait for its result.

import { apiExample, type ApiEndpoint } from "./api-example";
import { responseExamples } from "./responses";

export const runEndpoints: readonly ApiEndpoint[] = [
  {
    method: "POST",
    path: "/api/events/{id}/execute",
    description: "Queue a run of an event",
    scopes: ["full", "mcp"],
    parameters: [
      {
        name: "id",
        in: "path",
        type: "integer",
        required: true,
        description: "Event ID.",
      },
      {
        name: "input",
        in: "body",
        type: "object",
        required: false,
        description:
          "Data the script reads with cronium.input(). The body may be omitted, is limited to 1 MB, and may not contain any other field.",
      },
    ],
    status: 202,
    response: responseExamples.eventRun,
    notes:
      "Works in any event status and does not count toward maxExecutions. Answers 403 if the event is bound to an archived server or one you cannot use, and 409 if its overlap policy is SKIP and a previous run is still active.",
    example: apiExample({
      method: "POST",
      path: "/api/events/42/execute",
      body: { input: { commit: "9fceb02" } },
    }),
  },
  {
    method: "POST",
    path: "/api/workflows/{id}/execute",
    description: "Start a run of a workflow",
    scopes: ["full", "mcp"],
    parameters: [
      {
        name: "id",
        in: "path",
        type: "integer",
        required: true,
        description: "Workflow ID.",
      },
      {
        name: "input",
        in: "body",
        type: "object",
        required: false,
        description:
          "Data the starting steps read with cronium.input(). The body may be omitted, is limited to 1 MB, and may not contain any other field.",
      },
    ],
    status: 202,
    response: responseExamples.workflowRun,
    notes:
      "Works in any workflow status. Answers 403 if a step's event is not yours or is bound to an archived server or one you cannot use, and 409 with the reason if the workflow has no nodes, or no node without an incoming connection.",
    example: apiExample({
      method: "POST",
      path: "/api/workflows/12/execute",
      body: { input: { commit: "9fceb02" } },
    }),
  },
];

export const ciWaitForRun = `set -euo pipefail

# Queue the run. --fail turns any 4xx or 5xx response into a failed step.
LOG_ID=$(curl --silent --show-error --fail -X POST \\
  -H "Authorization: Bearer $CRONIUM_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d "{\\"input\\": {\\"commit\\": \\"$GITHUB_SHA\\"}}" \\
  https://cronium.example.com/api/events/42/execute | jq -r .logId)

# Wait for it to finish.
while true; do
  STATUS=$(curl --silent --show-error --fail \\
    -H "Authorization: Bearer $CRONIUM_TOKEN" \\
    "https://cronium.example.com/api/logs/$LOG_ID" | jq -r .status)
  case "$STATUS" in
    PENDING | RUNNING) sleep 5 ;;
    SUCCESS) exit 0 ;;
    *) echo "Run finished with status $STATUS" >&2; exit 1 ;;
  esac
done`;
