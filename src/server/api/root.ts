import { createTRPCRouter } from "./trpc";
import { eventsRouter } from "./routers/events";
import { workflowsRouter } from "./routers/workflows";
import { adminRouter } from "./routers/admin";
import { serversRouter } from "./routers/servers";
import { variablesRouter } from "./routers/variables";
import { logsRouter } from "./routers/logs";
import { monitoringRouter } from "./routers/monitoring";
import { toolsRouter } from "./routers/tools";
import { integrationsRouter } from "./routers/integrations";
import { webhooksRouter } from "./routers/webhooks";
import { settingsRouter } from "./routers/settings";
import { authRouter } from "./routers/auth";
import { aiRouter } from "./routers/ai";
import { dashboardRouter } from "./routers/dashboard";
import { systemRouter } from "./routers/system";
import { userAuthRouter } from "./routers/userAuth";
import type { inferRouterOutputs } from "@trpc/server";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  events: eventsRouter,
  workflows: workflowsRouter,
  admin: adminRouter,
  servers: serversRouter,
  variables: variablesRouter,
  logs: logsRouter,
  monitoring: monitoringRouter,
  tools: toolsRouter,
  integrations: integrationsRouter,
  webhooks: webhooksRouter,
  settings: settingsRouter,
  auth: authRouter,
  ai: aiRouter,
  dashboard: dashboardRouter,
  system: systemRouter,
  userAuth: userAuthRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

// export type helpers for inferring types
export type RouterOutputs = inferRouterOutputs<AppRouter>;
