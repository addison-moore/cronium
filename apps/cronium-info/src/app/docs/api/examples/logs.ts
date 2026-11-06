// Logs API documentation. These routes need a `full` token.

import { apiExample, type ApiEndpoint } from "./api-example";
import { responseExamples } from "./responses";

export const logEndpoints: readonly ApiEndpoint[] = [
  {
    method: "GET",
    path: "/api/logs",
    description: "List the logs of your runs, newest first",
    scopes: ["full"],
    parameters: [
      {
        name: "eventId",
        in: "query",
        type: "integer",
        required: false,
        description:
          "Only this event's logs. Answers 400 if it is not a number, 404 if the event does not exist, and 403 if it is not yours.",
      },
      {
        name: "workflowId",
        in: "query",
        type: "integer",
        required: false,
        description:
          "Only logs from this workflow's steps. `none` means logs from outside any workflow and `all` means no filter. Anything else that is not a number answers 400.",
      },
      {
        name: "status",
        in: "query",
        type: "string",
        required: false,
        description:
          "PENDING, RUNNING, SUCCESS, FAILURE, TIMEOUT or PARTIAL. Any other value is ignored.",
      },
      {
        name: "date",
        in: "query",
        type: "string",
        required: false,
        description: "Only runs started on this day, such as 2026-11-04.",
      },
      {
        name: "page",
        in: "query",
        type: "integer",
        required: false,
        description: "Page number. Defaults to 1.",
      },
      {
        name: "pageSize",
        in: "query",
        type: "integer",
        required: false,
        description:
          "Logs per page. Defaults to 20; values above 100 are capped.",
      },
    ],
    status: 200,
    response: responseExamples.logList,
    example: apiExample({
      method: "GET",
      path: "/api/logs?eventId=42&status=FAILURE&pageSize=50",
    }),
  },
  {
    method: "GET",
    path: "/api/logs/{id}",
    description: "Get one log, including the run's output",
    scopes: ["full"],
    parameters: [
      {
        name: "id",
        in: "path",
        type: "integer",
        required: true,
        description:
          "Log ID, such as the `logId` returned when you run an event. Answers 403 if the event is not yours.",
      },
    ],
    status: 200,
    response: responseExamples.log,
    notes:
      "A run is finished once `status` is SUCCESS, FAILURE, TIMEOUT or PARTIAL. Judge the run by `status`: the response also has `successful` and `exitCode` fields, but they are not set on every run. `scriptContent` is the event's current script.",
    example: apiExample({ method: "GET", path: "/api/logs/1001" }),
  },
];
