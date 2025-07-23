import { createTRPCRouter, publicProcedure } from "../trpc";
import { z } from "zod";
import { EventType } from "@/shared/schema";
import {
  getDefaultScriptContent,
  getDefaultHttpRequest,
} from "@/lib/scriptTemplates";
import { defaultToolActionTemplates } from "@/lib/default-tool-action-templates";
import { withCache } from "../middleware/cache";
import { CACHE_TTL } from "@/lib/cache/cache-service";

/**
 * Static Resources Router
 *
 * This router provides access to static resources that rarely change
 * and are good candidates for caching. These include:
 * - Script templates
 * - Tool action templates
 * - Default configurations
 */
export const staticResourcesRouter = createTRPCRouter({
  // Get script template by type - cached for 1 hour
  getScriptTemplate: publicProcedure
    .input(
      z.object({
        type: z.nativeEnum(EventType),
      }),
    )
    .query(async ({ input }) => {
      // Use cache wrapper for static templates
      return withCache(
        {
          key: `script-template:${input.type}`,
          keyPrefix: "static:",
          ttl: CACHE_TTL.STATIC, // 1 hour
        },
        async () => {
          const content = getDefaultScriptContent(input.type);
          return {
            type: input.type,
            content,
            ...(input.type === EventType.HTTP_REQUEST && {
              httpDefaults: getDefaultHttpRequest(),
            }),
          };
        },
      );
    }),

  // Get all script templates - cached for 1 hour
  getAllScriptTemplates: publicProcedure.query(async () => {
    return withCache(
      {
        key: "script-templates:all",
        keyPrefix: "static:",
        ttl: CACHE_TTL.STATIC, // 1 hour
      },
      async () => {
        const types = Object.values(EventType);
        return types.map((type) => ({
          type,
          content: getDefaultScriptContent(type),
          ...(type === EventType.HTTP_REQUEST && {
            httpDefaults: getDefaultHttpRequest(),
          }),
        }));
      },
    );
  }),

  // Get tool action templates - cached for 1 hour
  getToolActionTemplates: publicProcedure
    .input(
      z
        .object({
          toolType: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const cacheKey = input?.toolType
        ? `tool-templates:${input.toolType}`
        : "tool-templates:all";

      return withCache(
        {
          key: cacheKey,
          keyPrefix: "static:",
          ttl: CACHE_TTL.STATIC, // 1 hour
        },
        async () => {
          let templates = defaultToolActionTemplates;

          if (input?.toolType) {
            templates = templates.filter((t) => t.toolType === input.toolType);
          }

          return templates;
        },
      );
    }),

  // Get system constants - cached for 1 hour
  getSystemConstants: publicProcedure.query(async () => {
    return withCache(
      {
        key: "system-constants",
        keyPrefix: "static:",
        ttl: CACHE_TTL.STATIC, // 1 hour
      },
      async () => {
        return {
          supportedEventTypes: Object.values(EventType),
          supportedLanguages: ["bash", "nodejs", "python"],
          maxExecutionTimeout: 300000, // 5 minutes
          defaultExecutionTimeout: 60000, // 1 minute
          maxRetries: 3,
          defaultRetries: 0,
        };
      },
    );
  }),
});
