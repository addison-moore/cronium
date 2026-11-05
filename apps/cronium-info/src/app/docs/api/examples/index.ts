// API documentation data. The page renders it, and the contract test in
// apps/cronium-app/src/app/api/__tests__/documented-routes.test.ts holds it to the
// real routes: a documented route, method, field or token scope that the code does
// not support fails that test.

import type { ApiEndpoint } from "./api-example";
import { eventEndpoints } from "./events";
import { logEndpoints } from "./logs";
import { runEndpoints } from "./runs";
import { serverEndpoints } from "./servers";

export * from "./api-example";
export * from "./authentication";
export * from "./events";
export * from "./logs";
export * from "./responses";
export * from "./runs";
export * from "./servers";

export const allEndpoints: readonly ApiEndpoint[] = [
  ...runEndpoints,
  ...eventEndpoints,
  ...logEndpoints,
  ...serverEndpoints,
];
