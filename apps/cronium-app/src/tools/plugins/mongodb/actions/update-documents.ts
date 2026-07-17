import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import {
  mongoCredentialsSchema,
  updateDocumentsSchema,
  DEFAULT_MONGO_TIMEOUT_MS,
} from "../schemas";
import { updateDocuments } from "../client";
import {
  assertNonEmptyFilterForMany,
  coerceJsonObject,
  normalizeBooleanFields,
} from "../mongo-helpers";

export const updateDocumentsAction: ToolAction = {
  id: "update-documents",
  name: "Update Documents",
  description:
    "Update the first matching document (or all matches with Many) in a " +
    "MongoDB collection using atomic operators. Runs once (not retried).",
  category: "Data Operations",
  actionType: "update",
  actionTypeColor: "orange",
  developmentMode: "visual",
  inputSchema: updateDocumentsSchema,
  parameters: safeZodToParameters(updateDocumentsSchema),
  outputSchema: z.object({
    matchedCount: z.number().optional(),
    modifiedCount: z.number().optional(),
    upsertedCount: z.number().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  }),
  // A write's counts are not workflow input data.
  producesOutput: false,
  helpText:
    'Update must use atomic operators, e.g. {"$set": {"status": "done"}}. ' +
    "With Many enabled the filter must be non-empty (an empty filter would " +
    "update the whole collection). Enable Upsert to insert when nothing " +
    "matches.",
  examples: [
    {
      name: "Mark an order shipped",
      description: "Update one document by id",
      input: {
        collection: "orders",
        filter: { _id: { $oid: "{{cronium.input.orderId}}" } },
        update: { $set: { status: "shipped" } },
      },
      output: { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 },
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
      const parsed = updateDocumentsSchema.parse(
        normalizeBooleanFields(params, ["many", "upsert"]),
      );
      const filter = coerceJsonObject(parsed.filter, "Filter") ?? {};
      const update = coerceJsonObject(parsed.update, "Update");
      if (!update || Object.keys(update).length === 0) {
        throw new Error("Update must be a non-empty JSON object");
      }
      const many = parsed.many ?? false;
      if (many) assertNonEmptyFilterForMany(filter, "Update Documents");

      const result = await updateDocuments(
        creds,
        {
          collection: parsed.collection,
          filter,
          update,
          many,
          upsert: parsed.upsert ?? false,
        },
        { timeoutMs: context.timeoutMs ?? DEFAULT_MONGO_TIMEOUT_MS },
      );

      logger.info(
        `MongoDB update matched ${result.matchedCount}, modified ${result.modifiedCount} document(s) in ${parsed.collection}`,
      );
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown MongoDB error";
      logger.error(`MongoDB update-documents failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
