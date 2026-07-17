/**
 * @jest-environment node
 */
jest.mock("../client", () => ({
  findDocuments: jest.fn(),
  aggregateDocuments: jest.fn(),
  insertDocuments: jest.fn(),
  updateDocuments: jest.fn(),
  deleteDocuments: jest.fn(),
}));

import {
  findDocuments,
  aggregateDocuments,
  insertDocuments,
  updateDocuments,
  deleteDocuments,
} from "../client";
import { findDocumentsAction } from "../actions/find-documents";
import { aggregateDocumentsAction } from "../actions/aggregate-documents";
import { insertDocumentsAction } from "../actions/insert-documents";
import { updateDocumentsAction } from "../actions/update-documents";
import { deleteDocumentsAction } from "../actions/delete-documents";
import type { ExecutionContext } from "@/tools/types/tool-plugin";

const mockFind = findDocuments as jest.Mock;
const mockAggregate = aggregateDocuments as jest.Mock;
const mockInsert = insertDocuments as jest.Mock;
const mockUpdate = updateDocuments as jest.Mock;
const mockDelete = deleteDocuments as jest.Mock;

const creds = {
  scheme: "mongodb",
  host: "h",
  database: "d",
  user: "u",
  password: "p",
  tls: "default",
};

const MB5 = 5 * 1024 * 1024;

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    variables: { get: jest.fn(), set: jest.fn() },
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    ...overrides,
  };
}

function readResult(overrides: Record<string, unknown> = {}) {
  return {
    documents: [],
    documentCount: 0,
    truncated: false,
    bytesExceeded: false,
    ...overrides,
  };
}

beforeEach(() => jest.clearAllMocks());

describe("find-documents action", () => {
  it("emits its documents into Unified I/O (producesOutput)", () => {
    expect(findDocumentsAction.producesOutput).toBe(true);
  });

  it("returns { documents, documentCount } and passes both limits", async () => {
    mockFind.mockResolvedValue(
      readResult({ documents: [{ a: 1 }], documentCount: 1 }),
    );
    const res = await findDocumentsAction.execute(
      creds,
      { collection: "orders", filter: '{"status": "open"}' },
      ctx(),
    );
    expect(res).toEqual({ documents: [{ a: 1 }], documentCount: 1 });
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({ host: "h" }),
      expect.objectContaining({
        collection: "orders",
        filter: { status: "open" },
      }),
      { maxDocuments: 10_000, maxBytes: MB5, timeoutMs: 30_000 },
    );
  });

  it("uses the event timeout (context.timeoutMs)", async () => {
    mockFind.mockResolvedValue(readResult());
    await findDocumentsAction.execute(
      creds,
      { collection: "c" },
      ctx({ timeoutMs: 5_000 }),
    );
    expect(mockFind.mock.calls[0][2].timeoutMs).toBe(5_000);
  });

  it("fails instead of silently truncating when the document cap is exceeded", async () => {
    mockFind.mockResolvedValue(readResult({ truncated: true }));
    const res = (await findDocumentsAction.execute(
      creds,
      { collection: "c" },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("more than 10000 documents");
  });

  it("fails when the streamed result hits the byte budget", async () => {
    mockFind.mockResolvedValue(readResult({ bytesExceeded: true }));
    const res = (await findDocumentsAction.execute(
      creds,
      { collection: "c" },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("5.0 MB limit");
  });

  it("honors an explicit maxDocuments override", async () => {
    mockFind.mockResolvedValue(readResult());
    await findDocumentsAction.execute(
      creds,
      { collection: "c", maxDocuments: 50 },
      ctx(),
    );
    expect(mockFind.mock.calls[0][2].maxDocuments).toBe(50);
  });

  it("rejects a malformed filter and never touches the client", async () => {
    const res = (await findDocumentsAction.execute(
      creds,
      { collection: "c", filter: "[1,2]" },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("Filter must be a JSON object");
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns { success:false } when the client throws", async () => {
    mockFind.mockRejectedValue(new Error("boom"));
    const res = (await findDocumentsAction.execute(
      creds,
      { collection: "c" },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res).toEqual({ success: false, error: "boom" });
  });
});

describe("aggregate-documents action", () => {
  it("emits its documents into Unified I/O (producesOutput)", () => {
    expect(aggregateDocumentsAction.producesOutput).toBe(true);
  });

  it("parses a JSON pipeline string and returns the documents", async () => {
    mockAggregate.mockResolvedValue(
      readResult({ documents: [{ _id: "open", n: 2 }], documentCount: 1 }),
    );
    const res = await aggregateDocumentsAction.execute(
      creds,
      { collection: "orders", pipeline: '[{"$match": {"a": 1}}]' },
      ctx(),
    );
    expect(res).toEqual({
      documents: [{ _id: "open", n: 2 }],
      documentCount: 1,
    });
    expect(mockAggregate.mock.calls[0][1].pipeline).toEqual([
      { $match: { a: 1 } },
    ]);
  });

  it("rejects $out/$merge write stages and never touches the client", async () => {
    const res = (await aggregateDocumentsAction.execute(
      creds,
      { collection: "c", pipeline: [{ $out: "other" }] },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("$out");
    expect(mockAggregate).not.toHaveBeenCalled();
  });

  it("fails when the pipeline produces more than the cap", async () => {
    mockAggregate.mockResolvedValue(readResult({ truncated: true }));
    const res = (await aggregateDocumentsAction.execute(
      creds,
      { collection: "c", pipeline: [{ $match: {} }] },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("$limit");
  });
});

describe("insert-documents action", () => {
  it("does not emit output and wraps a single document", async () => {
    expect(insertDocumentsAction.producesOutput).toBe(false);
    mockInsert.mockResolvedValue({ insertedCount: 1, insertedIds: ["x"] });
    const res = await insertDocumentsAction.execute(
      creds,
      { collection: "logs", documents: '{"a": 1}' },
      ctx(),
    );
    expect(res).toEqual({ insertedCount: 1, insertedIds: ["x"] });
    expect(mockInsert.mock.calls[0][1].documents).toEqual([{ a: 1 }]);
  });

  it("rejects an empty documents array", async () => {
    const res = (await insertDocumentsAction.execute(
      creds,
      { collection: "logs", documents: "[]" },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("update-documents action", () => {
  it("updates one by default and passes flags through", async () => {
    expect(updateDocumentsAction.producesOutput).toBe(false);
    mockUpdate.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    });
    const res = await updateDocumentsAction.execute(
      creds,
      {
        collection: "orders",
        filter: '{"a": 1}',
        update: '{"$set": {"b": 2}}',
      },
      ctx(),
    );
    expect(res).toEqual({
      matchedCount: 1,
      modifiedCount: 1,
      upsertedCount: 0,
    });
    expect(mockUpdate.mock.calls[0][1]).toEqual({
      collection: "orders",
      filter: { a: 1 },
      update: { $set: { b: 2 } },
      many: false,
      upsert: false,
    });
  });

  it('accepts form-persisted "true" strings for many/upsert', async () => {
    mockUpdate.mockResolvedValue({
      matchedCount: 2,
      modifiedCount: 2,
      upsertedCount: 0,
    });
    await updateDocumentsAction.execute(
      creds,
      {
        collection: "orders",
        filter: '{"a": 1}',
        update: '{"$set": {"b": 2}}',
        many: "true",
        upsert: "false",
      },
      ctx(),
    );
    expect(mockUpdate.mock.calls[0][1]).toMatchObject({
      many: true,
      upsert: false,
    });
  });

  it("refuses many with an empty filter", async () => {
    const res = (await updateDocumentsAction.execute(
      creds,
      {
        collection: "c",
        filter: "{}",
        update: '{"$set": {"a": 1}}',
        many: true,
      },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("non-empty filter");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("refuses an empty update", async () => {
    const res = (await updateDocumentsAction.execute(
      creds,
      { collection: "c", filter: '{"a": 1}', update: "{}" },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("Update must be a non-empty JSON object");
  });
});

describe("delete-documents action", () => {
  it("deletes one by default and returns the count", async () => {
    expect(deleteDocumentsAction.producesOutput).toBe(false);
    mockDelete.mockResolvedValue({ deletedCount: 1 });
    const res = await deleteDocumentsAction.execute(
      creds,
      { collection: "sessions", filter: '{"a": 1}' },
      ctx(),
    );
    expect(res).toEqual({ deletedCount: 1 });
    expect(mockDelete.mock.calls[0][1]).toEqual({
      collection: "sessions",
      filter: { a: 1 },
      many: false,
    });
  });

  it("refuses any delete with an empty filter", async () => {
    const res = (await deleteDocumentsAction.execute(
      creds,
      { collection: "c", filter: "{}" },
      ctx(),
    )) as { success?: boolean; error?: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain("non-empty filter");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
