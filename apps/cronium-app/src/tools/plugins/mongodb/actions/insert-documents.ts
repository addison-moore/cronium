import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import {
  mongoCredentialsSchema,
  insertDocumentsSchema,
  DEFAULT_MONGO_TIMEOUT_MS,
} from "../schemas";
import { insertDocuments } from "../client";
import { coerceJsonDocuments } from "../mongo-helpers";

export const insertDocumentsAction: ToolAction = {
  id: "insert-documents",
  name: "Insert Documents",
  description:
    "Insert one or more documents into a MongoDB collection and return the " +
    "inserted count and ids. Runs once (not retried).",
  category: "Data Operations",
  actionType: "create",
  actionTypeColor: "green",
  developmentMode: "visual",
  inputSchema: insertDocumentsSchema,
  parameters: safeZodToParameters(insertDocumentsSchema),
  outputSchema: z.object({
    insertedCount: z.number().optional(),
    insertedIds: z.array(z.string()).optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  }),
  // A write's counts are not workflow input data.
  producesOutput: false,
  helpText:
    "Documents is a JSON object (one document) or array (many). Extended " +
    'JSON is supported for types, e.g. {"createdAt": {"$date": ' +
    '"2026-01-01T00:00:00Z"}}. Use {{cronium.input.*}} to insert values from ' +
    "the previous step.",
  examples: [
    {
      name: "Insert a document",
      description: "Single insert returning the generated id",
      input: {
        collection: "audit_log",
        documents: { action: "deploy", status: "{{cronium.input.status}}" },
      },
      output: {
        insertedCount: 1,
        insertedIds: ["507f1f77bcf86cd799439011"],
      },
    },
  ],

  async execute(
    credentials: unknown,
    params: unknown,
    context: ExecutionContext,
  ) {
    const { logger } = context;
    try {
      const creds = mongoCredentialsSchema.parse(credentials);
      const parsed = insertDocumentsSchema.parse(params);
      const documents = coerceJsonDocuments(parsed.documents);

      const result = await insertDocuments(
        creds,
        { collection: parsed.collection, documents },
        { timeoutMs: context.timeoutMs ?? DEFAULT_MONGO_TIMEOUT_MS },
      );

      logger.info(
        `MongoDB inserted ${result.insertedCount} document(s) into ${parsed.collection}`,
      );
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown MongoDB error";
      logger.error(`MongoDB insert-documents failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
