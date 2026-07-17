import { z } from "zod";
import type { ToolAction, ExecutionContext } from "@/tools/types/tool-plugin";
import { safeZodToParameters } from "@/tools/utils/zod-to-parameters";
import { MAX_UNIFIED_IO_OUTPUT_BYTES, toMb } from "@/lib/unified-io/limits";
import {
  mongoCredentialsSchema,
  aggregateDocumentsSchema,
  DEFAULT_MAX_DOCUMENTS,
  DEFAULT_MONGO_TIMEOUT_MS,
} from "../schemas";
import { aggregateDocuments } from "../client";
import { assertReadOnlyPipeline, coercePipeline } from "../mongo-helpers";

export const aggregateDocumentsAction: ToolAction = {
  id: "aggregate-documents",
  name: "Aggregate Documents",
  description:
    "Run a read-only aggregation pipeline on a MongoDB collection and return " +
    "the resulting documents. The result is passed to the next workflow step " +
    "via cronium.input().",
  category: "Data Operations",
  actionType: "search",
  actionTypeColor: "purple",
  developmentMode: "visual",
  inputSchema: aggregateDocumentsSchema,
  parameters: safeZodToParameters(aggregateDocumentsSchema),
  outputSchema: z.object({
    documents: z.array(z.record(z.string(), z.unknown())).optional(),
    documentCount: z.number().optional(),
    success: z.boolean().optional(),
    error: z.string().optional(),
  }),
  producesOutput: true,
  helpText:
    "The pipeline is a JSON array of stages. Write stages ($out, $merge) are " +
    "rejected — use the write actions or a Script event to modify data. " +
    "Downstream events read {{cronium.input.documents}}.",
  examples: [
    {
      name: "Count orders by status",
      description: "Grouped aggregation feeding the next workflow step",
      input: {
        collection: "orders",
        pipeline: [
          { $match: { createdAt: { $gt: { $date: "2026-01-01T00:00:00Z" } } } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ],
      },
      output: {
        documents: [
          { _id: "open", count: 12 },
          { _id: "shipped", count: 40 },
        ],
        documentCount: 2,
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
      const parsed = aggregateDocumentsSchema.parse(params);
      const pipeline = coercePipeline(parsed.pipeline);

      assertReadOnlyPipeline(pipeline);

      const maxDocuments = parsed.maxDocuments ?? DEFAULT_MAX_DOCUMENTS;
      const result = await aggregateDocuments(
        creds,
        { collection: parsed.collection, pipeline },
        {
          maxDocuments,
          maxBytes: MAX_UNIFIED_IO_OUTPUT_BYTES,
          timeoutMs: context.timeoutMs ?? DEFAULT_MONGO_TIMEOUT_MS,
        },
      );

      if (result.bytesExceeded) {
        throw new Error(
          `Aggregation result exceeds the ${toMb(MAX_UNIFIED_IO_OUTPUT_BYTES)} MB limit for data passed between events. ` +
            `Project fewer fields, add a $limit stage, or move bulk work to a Script event that streams.`,
        );
      }
      if (result.truncated) {
        throw new Error(
          `Aggregation produced more than ${maxDocuments} documents. Add a $limit stage, or raise Max Documents. ` +
            `For large extracts, prefer a Script event that streams rather than passing every document between events.`,
        );
      }

      logger.info(
        `MongoDB aggregation returned ${result.documentCount} document(s) from ${parsed.collection}`,
      );

      return {
        documents: result.documents,
        documentCount: result.documentCount,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown MongoDB error";
      logger.error(`MongoDB aggregate-documents failed: ${message}`);
      return { success: false, error: message };
    }
  },
};
