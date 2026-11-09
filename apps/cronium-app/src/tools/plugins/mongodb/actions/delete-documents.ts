import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import { checkFirst, counted, writeRun } from "@/tools/utils/test-run";
import {
  mongoCredentialsSchema,
  deleteDocumentsSchema,
  DEFAULT_MONGO_TIMEOUT_MS,
} from "../schemas";
import { countMatchingDocuments, deleteDocuments } from "../client";
import {
  type MatchCount,
  assertNonEmptyFilterForMany,
  coerceJsonObject,
  matchesFound,
  normalizeBooleanFields,
} from "../mongo-helpers";

export const deleteDocumentsAction: ToolAction = {
  id: "delete-documents",
  name: "Delete Documents",
  description:
    "Delete the first matching document (or all matches with Many) from a " +
    "MongoDB collection. Runs once (not retried).",
  category: "Data Operations",
  actionType: "delete",
  actionTypeColor: "red",
  developmentMode: "visual",
  testRun: writeRun(
    (result: { deletedCount: number }) =>
      `Deleted ${counted(result.deletedCount, "document")}.`,
    checkFirst(
      "Count Matches",
      "says how many documents the filter matches, and deletes nothing",
      ({ matchedCount, many }: MatchCount) =>
        matchesFound(matchedCount) +
        (!many && matchedCount > 1
          ? ", but without Many only the first would be deleted"
          : "") +
        ". Nothing was deleted, so this doesn't show that the delete would be allowed.",
    ),
  ),
  inputSchema: deleteDocumentsSchema,
  parameters: safeZodToParameters(deleteDocumentsSchema),
  outputSchema: z.object({
    deletedCount: z.number().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  }),
  // A write's counts are not workflow input data.
  producesOutput: false,
  helpText:
    "The filter must be a non-empty JSON object — deleting with an empty " +
    "filter is refused. With Many disabled only the first match is deleted.",
  examples: [
    {
      name: "Delete expired sessions",
      description: "Delete every document matching a filter",
      input: {
        collection: "sessions",
        filter: { expiresAt: { $lt: { $date: "2026-07-01T00:00:00Z" } } },
        many: true,
      },
      output: { deletedCount: 42 },
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
      const parsed = deleteDocumentsSchema.parse(
        normalizeBooleanFields(params, ["many"]),
      );
      const filter = coerceJsonObject(parsed.filter, "Filter") ?? {};
      // Deleting is destructive either way: require an explicit filter even
      // for deleteOne, so a template that rendered to nothing can't delete an
      // arbitrary document.
      if (Object.keys(filter).length === 0) {
        throw new Error(
          "Delete Documents requires a non-empty filter. Use a Script event for whole-collection maintenance.",
        );
      }
      const many = parsed.many ?? false;
      if (many) assertNonEmptyFilterForMany(filter, "Delete Documents");
      const timeoutMs = context.timeoutMs ?? DEFAULT_MONGO_TIMEOUT_MS;

      // The form's Count Matches: the same filter on the same collection, counted
      // instead of deleted.
      if (context.isTest) {
        const matchedCount = await countMatchingDocuments(
          creds,
          { collection: parsed.collection, filter },
          { timeoutMs },
        );
        logger.info(
          `MongoDB check: ${matchedCount} document(s) in ${parsed.collection} match the filter, and none were deleted`,
        );
        const found: MatchCount = { matchedCount, many };
        return found;
      }

      const result = await deleteDocuments(
        creds,
        { collection: parsed.collection, filter, many },
        { timeoutMs },
      );

      logger.info(
        `MongoDB delete removed ${result.deletedCount} document(s) from ${parsed.collection}`,
      );
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown MongoDB error";
      logger.error(`MongoDB delete-documents failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
