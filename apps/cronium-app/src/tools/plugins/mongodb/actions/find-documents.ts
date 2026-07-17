import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import { MAX_UNIFIED_IO_OUTPUT_BYTES, toMb } from "@/lib/unified-io/limits";
import {
  mongoCredentialsSchema,
  findDocumentsSchema,
  DEFAULT_MAX_DOCUMENTS,
  DEFAULT_MONGO_TIMEOUT_MS,
} from "../schemas";
import { findDocuments } from "../client";
import { coerceJsonObject } from "../mongo-helpers";

export const findDocumentsAction: ToolAction = {
  id: "find-documents",
  name: "Find Documents",
  description:
    "Query a MongoDB collection with a filter and return the matching " +
    "documents. The result is passed to the next workflow step via " +
    "cronium.input().",
  category: "Data Operations",
  actionType: "search",
  actionTypeColor: "purple",
  developmentMode: "visual",
  inputSchema: findDocumentsSchema,
  parameters: safeZodToParameters(findDocumentsSchema),
  outputSchema: z.object({
    documents: z.array(z.record(z.string(), z.unknown())).optional(),
    documentCount: z.number().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  }),
  // Read action: its documents flow into Unified I/O so the next event's
  // cronium.input() receives { documents, documentCount }.
  producesOutput: true,
  helpText:
    "Filter, projection and sort are JSON. Extended JSON is supported for " +
    'types, e.g. {"_id": {"$oid": "{{cronium.input.id}}"}} or ' +
    '{"createdAt": {"$gt": {"$date": "2026-01-01T00:00:00Z"}}}. Downstream ' +
    "events read {{cronium.input.documents}}.",
  examples: [
    {
      name: "Fetch open orders",
      description: "Filtered read feeding the next workflow step",
      input: {
        collection: "orders",
        filter: { status: "open" },
        sort: { createdAt: -1 },
      },
      output: {
        documents: [{ _id: "507f1f77bcf86cd799439011", status: "open" }],
        documentCount: 1,
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
      const parsed = findDocumentsSchema.parse(params);

      const maxDocuments = parsed.maxDocuments ?? DEFAULT_MAX_DOCUMENTS;
      // The client streams and stops at whichever limit is hit first, so peak
      // memory is bounded by maxBytes regardless of how many documents match.
      const result = await findDocuments(
        creds,
        {
          collection: parsed.collection,
          filter: coerceJsonObject(parsed.filter, "Filter"),
          projection: coerceJsonObject(parsed.projection, "Projection"),
          sort: coerceJsonObject(parsed.sort, "Sort"),
        },
        {
          maxDocuments,
          maxBytes: MAX_UNIFIED_IO_OUTPUT_BYTES,
          timeoutMs: context.timeoutMs ?? DEFAULT_MONGO_TIMEOUT_MS,
        },
      );

      // Never hand back a silently-shortened result: an ETL that received 10k
      // of 15k documents would look successful while dropping data.
      if (result.bytesExceeded) {
        throw new Error(
          `Query result exceeds the ${toMb(MAX_UNIFIED_IO_OUTPUT_BYTES)} MB limit for data passed between events. ` +
            `Narrow the filter, use a projection, or move bulk work to a Script event that streams.`,
        );
      }
      if (result.truncated) {
        throw new Error(
          `Query matched more than ${maxDocuments} documents. Narrow the filter, or raise Max Documents. ` +
            `For large extracts, prefer a Script event that streams rather than passing every document between events.`,
        );
      }

      logger.info(
        `MongoDB find returned ${result.documentCount} document(s) from ${parsed.collection}`,
      );

      return {
        documents: result.documents,
        documentCount: result.documentCount,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown MongoDB error";
      logger.error(`MongoDB find-documents failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
