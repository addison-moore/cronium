import { z } from "zod";
import { type PluginApiRoutes } from "../../types/tool-plugin";
import { emailSendSchema, emailCredentialsSchema } from "./schemas";

// Response schemas
const testConnectionResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z
    .object({
      latency: z.number().optional(),
      serverInfo: z.string().optional(),
    })
    .optional(),
});

const sendEmailResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  messageId: z.string().optional(),
  recipients: z
    .array(
      z.object({
        email: z.string(),
        status: z.enum(["sent", "failed", "pending"]),
        error: z.string().optional(),
      }),
    )
    .optional(),
});

// Bulk send schema
const bulkSendEmailSchema = z.object({
  toolId: z.number().int().positive(),
  emails: z.array(emailSendSchema.omit({ toolId: true })),
});

const bulkSendResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  results: z.array(
    z.object({
      index: z.number(),
      success: z.boolean(),
      messageId: z.string().optional(),
      error: z.string().optional(),
    }),
  ),
});

export const emailApiRoutes: PluginApiRoutes = {
  testConnection: {
    path: "testConnection",
    method: "mutation",
    description: "Test the email server connection",
    handler: {
      input: z.object({
        toolId: z.number().int().positive(),
      }),
      output: testConnectionResponseSchema,
      handler: async () => {
        // The actual implementation happens server-side
        // This is just the route definition
        return {
          success: true,
          message: "Email handler registered",
        };
      },
    },
    requiresAuth: true,
    requiresActiveStatus: true,
  },

  send: {
    path: "send",
    method: "mutation",
    description: "Send an email",
    handler: {
      input: emailSendSchema,
      output: sendEmailResponseSchema,
      handler: async () => {
        // The actual implementation happens server-side
        // This is just the route definition
        return {
          success: true,
          message: "Email handler registered",
        };
      },
    },
    requiresAuth: true,
    requiresActiveStatus: true,
  },

  bulkSend: {
    path: "bulkSend",
    method: "mutation",
    description: "Send multiple emails in bulk",
    handler: {
      input: bulkSendEmailSchema,
      output: bulkSendResponseSchema,
      handler: async () => {
        // The actual implementation happens server-side
        // This is just the route definition
        return {
          success: true,
          message: "Bulk email handler registered",
          results: [],
        };
      },
    },
    requiresAuth: true,
    requiresActiveStatus: true,
  },

  validateCredentials: {
    path: "validateCredentials",
    method: "query",
    description: "Validate email credentials format",
    handler: {
      input: z.object({
        credentials: z.record(z.string(), z.unknown()),
      }),
      output: z.object({
        valid: z.boolean(),
        errors: z.array(z.string()).optional(),
      }),
      handler: async ({ input }) => {
        const typedInput = input as { credentials: Record<string, unknown> };
        const result = emailCredentialsSchema.safeParse(typedInput.credentials);

        if (result.success) {
          return { valid: true };
        }

        const zodErrors = result.error.issues as z.ZodIssue[];
        const errorMessages = zodErrors.map((err) => {
          const path = err.path.join(".");
          return `${path}: ${err.message}`;
        });

        return {
          valid: false,
          errors: errorMessages,
        };
      },
    },
    requiresAuth: true,
  },
};
