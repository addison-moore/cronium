import { z } from "zod";

/**
 * Connection scheme. `mongodb+srv` (Atlas and other DNS-seedlist deployments)
 * resolves hosts via SRV records — no port — and implies TLS; plain `mongodb`
 * is a direct host:port connection.
 */
export const MONGO_SCHEMES = ["mongodb", "mongodb+srv"] as const;
export type MongoScheme = (typeof MONGO_SCHEMES)[number];

/** `default` lets the scheme decide (srv → TLS on, plain → off). */
export const MONGO_TLS_MODES = ["default", "enable", "disable"] as const;

// `password` is intentionally named to match the secret-key redaction pattern
// (lib/tools/credential-redaction.ts), so it is blanked in API responses and a
// blank submit on edit keeps the stored value.
export const mongoCredentialsSchema = z.object({
  scheme: z.enum(MONGO_SCHEMES).default("mongodb"),
  host: z.string().min(1, "Host is required"),
  port: z.coerce.number().int().positive().max(65535).optional(),
  database: z.string().min(1, "Database is required"),
  user: z.string().optional().default(""),
  password: z.string().optional().default(""),
  authSource: z.string().optional(),
  tls: z.enum(MONGO_TLS_MODES).default("default"),
});

export type MongoCredentials = z.infer<typeof mongoCredentialsSchema>;

export const DEFAULT_MONGO_PORT = 27017;

// Same guardrail rationale as the SQL tool (see sql/schemas.ts): tool actions
// run in-process and the result is held in memory and written to job.result,
// so reads are bounded and exceeding a bound FAILS rather than silently
// truncating. The operation timeout comes from the event's Timeout setting.
export const DEFAULT_MAX_DOCUMENTS = 10_000;
export const MAX_DOCUMENTS_CEILING = 1_000_000;
export const DEFAULT_MONGO_TIMEOUT_MS = 30_000;

// ---- Action input schemas -------------------------------------------------

// Documents/filters may be authored as JSON in the generic action form (which
// stores a record as a text field) or arrive as already-parsed objects; the
// coerce* helpers in mongo-helpers.ts normalize both in execute(). Values may
// be `{{cronium.input.*}}` templates; the platform renders them before
// execute(). MongoDB Extended JSON type wrappers are supported, e.g.
// {"_id": {"$oid": "..."}} and {"$date": "..."}.

const collectionField = z
  .string()
  .min(1, "Collection is required")
  .describe("The collection to operate on, e.g. orders.");

const filterField = z
  .union([z.record(z.string(), z.unknown()), z.string()])
  .describe(
    'JSON filter selecting the documents, e.g. {"status": "open"} or {"_id": {"$oid": "{{cronium.input.id}}"}}. Extended JSON ($oid, $date) is supported.',
  );

const maxDocumentsField = z.coerce
  .number()
  .int()
  .positive()
  .max(MAX_DOCUMENTS_CEILING)
  .optional()
  .describe(
    "Optional. Maximum documents to return (default 10,000). The action fails if more match, rather than silently dropping documents — add a filter/limit or raise this. Very large extracts should use a Script event instead of passing documents between events.",
  );

export const findDocumentsSchema = z.object({
  collection: collectionField,
  filter: filterField
    .optional()
    .describe(
      'Optional JSON filter, e.g. {"status": "open"}. Leave blank to match all documents (bounded by Max Documents). Extended JSON ($oid, $date) is supported.',
    ),
  projection: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .optional()
    .describe(
      'Optional JSON projection of fields to include/exclude, e.g. {"email": 1, "_id": 0}.',
    ),
  sort: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .optional()
    .describe(
      'Optional JSON sort specification, e.g. {"createdAt": -1}. 1 = ascending, -1 = descending.',
    ),
  maxDocuments: maxDocumentsField,
});
export type FindDocumentsParams = z.infer<typeof findDocumentsSchema>;

export const aggregateDocumentsSchema = z.object({
  collection: collectionField,
  pipeline: z
    .union([z.array(z.unknown()), z.string()])
    .describe(
      'JSON array of aggregation stages, e.g. [{"$match": {"status": "open"}}, {"$group": {"_id": "$region", "n": {"$sum": 1}}}]. Write stages ($out, $merge) are rejected — this is a read.',
    ),
  maxDocuments: maxDocumentsField,
});
export type AggregateDocumentsParams = z.infer<typeof aggregateDocumentsSchema>;

export const insertDocumentsSchema = z.object({
  collection: collectionField,
  documents: z
    .union([
      z.array(z.unknown()),
      z.record(z.string(), z.unknown()),
      z.string(),
    ])
    .describe(
      'A JSON document or array of documents to insert, e.g. {"name": "a"} or [{"name": "a"}, {"name": "b"}]. Extended JSON ($date, $oid) is supported.',
    ),
});
export type InsertDocumentsParams = z.infer<typeof insertDocumentsSchema>;

export const updateDocumentsSchema = z.object({
  collection: collectionField,
  filter: filterField,
  update: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .describe(
      'JSON update using atomic operators, e.g. {"$set": {"status": "done"}, "$inc": {"attempts": 1}}.',
    ),
  many: z
    .boolean()
    .optional()
    .describe(
      "Update every matching document instead of just the first. Requires a non-empty filter.",
    ),
  upsert: z
    .boolean()
    .optional()
    .describe("Insert a new document when no document matches the filter."),
});
export type UpdateDocumentsParams = z.infer<typeof updateDocumentsSchema>;

export const deleteDocumentsSchema = z.object({
  collection: collectionField,
  filter: filterField,
  many: z
    .boolean()
    .optional()
    .describe(
      "Delete every matching document instead of just the first. Requires a non-empty filter.",
    ),
});
export type DeleteDocumentsParams = z.infer<typeof deleteDocumentsSchema>;
