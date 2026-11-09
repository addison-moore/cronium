/**
 * @jest-environment node
 *
 * The event form's button runs an action with `isTest: true`, and that only stops an
 * action whose code reads it. Each action declares which it is in `testRun`, and the form
 * goes by that: whether to ask first, what the button says, what the toast says. A wrong
 * declaration tells someone that a delete is a simulation, so these run the real actions
 * with only their ways out of this process replaced, and compare what they do with what
 * they say.
 */
const mockOut = jest.fn<void, [string]>();

/** What each service answers a real run with, as far as the actions read it. */
function mockAnswer(tool: string): Response {
  switch (tool) {
    case "slack":
      return new Response("ok");
    case "teams":
      return new Response("1");
    case "discord":
      return new Response(JSON.stringify({ id: "1" }));
    default:
      return new Response(JSON.stringify({ id: "1", url: "https://x.test/1" }));
  }
}

jest.mock("@/lib/tools/safe-fetch", () => ({
  ...jest.requireActual<typeof import("@/lib/tools/safe-fetch")>(
    "@/lib/tools/safe-fetch",
  ),
  toolFetch: new Proxy(
    {},
    {
      get: (_target, tool: string) => () => {
        mockOut(`fetch:${tool}`);
        return Promise.resolve(mockAnswer(tool));
      },
    },
  ),
}));

jest.mock("@/tools/plugins/sql/drivers", () => ({
  getDriver: () => ({
    query: () => {
      mockOut("sql:query");
      return Promise.resolve({
        columns: ["id"],
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
        rowCount: 3,
        truncated: false,
        bytesExceeded: false,
      });
    },
    execute: () => {
      mockOut("sql:execute");
      return Promise.resolve({ rowCount: 2 });
    },
  }),
}));

jest.mock("@/tools/plugins/mongodb/client", () => ({
  findDocuments: () => {
    mockOut("mongo:find");
    return Promise.resolve({
      documents: [{ _id: 1 }],
      documentCount: 1,
      truncated: false,
      bytesExceeded: false,
    });
  },
  aggregateDocuments: () => {
    mockOut("mongo:aggregate");
    return Promise.resolve({
      documents: [{ _id: 1 }, { _id: 2 }],
      documentCount: 2,
      truncated: false,
      bytesExceeded: false,
    });
  },
  insertDocuments: () => {
    mockOut("mongo:insert");
    return Promise.resolve({ insertedCount: 1, insertedIds: [9] });
  },
  updateDocuments: () => {
    mockOut("mongo:update");
    return Promise.resolve({
      matchedCount: 3,
      modifiedCount: 2,
      upsertedCount: 0,
    });
  },
  deleteDocuments: () => {
    mockOut("mongo:delete");
    return Promise.resolve({ deletedCount: 1 });
  },
}));

jest.mock("@/lib/email", () => ({
  sendEmailDetailed: () => {
    mockOut("smtp");
    return Promise.resolve({
      messageId: "m",
      accepted: ["a@example.test"],
      rejected: [],
    });
  },
}));

jest.mock("@/lib/ai", () => ({
  generateText: () => {
    mockOut("ai");
    return Promise.resolve({
      text: "hello",
      model: "m",
      provider: "custom",
      usage: {},
      finishReason: "stop",
    });
  },
}));

import {
  getAllServerActionIds,
  getServerActionById,
} from "@/lib/tools/tool-registry";
import { isFailureResult } from "@/lib/tools/action-result";
import type {
  ActionTestRun,
  ExecutionContext,
} from "@/tools/types/tool-plugin";

const context = (isTest: boolean): ExecutionContext => ({
  variables: { get: () => null, set: () => undefined },
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
  isTest,
});

const slack = { webhookUrl: "https://hooks.slack.com/services/T/B/x" };
const discord = { webhookUrl: "https://discord.com/api/webhooks/1/x" };
const smtp = {
  smtpHost: "smtp.example.test",
  smtpPort: 587,
  smtpUser: "u",
  smtpPassword: "p",
  fromEmail: "from@example.test",
};
const ai = {
  provider: "custom",
  apiKey: "k",
  baseUrl: "https://ai.example.test/v1",
  defaultModel: "m",
};
const sql = {
  dialect: "postgres",
  host: "db.example.test",
  port: 5432,
  database: "d",
  user: "u",
  password: "p",
};
const mongo = { scheme: "mongodb", host: "mongo.example.test", database: "d" };
const notion = { apiKey: "k" };
const trello = { apiKey: "k", apiToken: "t" };
const sheets = { oauthToken: "t" };
const teamsUrl = "https://x.webhook.office.com/webhookb2/1";

const WRITES =
  "There's no test mode: this really changes your data, and can't be undone.";
const READS = "Really runs on this database, read-only.";
const simulatedExplains = (service: string) =>
  `Checks the parameters only. Nothing goes to ${service}, so this doesn't show that the credential works.`;
const simulatedSays = (service: string) =>
  `Nothing was sent to ${service}. The parameters are valid.`;

interface Case {
  id: string;
  kind: ActionTestRun["kind"];
  credentials: unknown;
  parameters: Record<string, unknown>;
  explains: string;
  says: string;
}

const REAL: Case[] = [
  {
    id: "slack-send-message",
    kind: "sends",
    credentials: slack,
    parameters: { channel: "#a", text: "hi" },
    explains: "There's no test mode: this really posts to Slack.",
    says: "Slack accepted the message.",
  },
  {
    id: "discord-send-message",
    kind: "sends",
    credentials: discord,
    parameters: { content: "hi" },
    explains: "There's no test mode: this really posts to Discord.",
    says: "Discord accepted the message.",
  },
  {
    id: "send-email",
    kind: "sends",
    credentials: smtp,
    parameters: { to: "a@example.test", subject: "s", body: "b" },
    explains: "There's no test mode: this really sends the email.",
    says: "The mail server accepted it for 1 recipient.",
  },
  {
    id: "ai-prompt",
    kind: "spends",
    credentials: ai,
    parameters: { userPrompt: "hi" },
    explains:
      "There's no test mode: this really sends the prompt to the model, and your provider may charge for it.",
    says: "The model answered.",
  },
  {
    id: "run-query",
    kind: "reads",
    credentials: sql,
    parameters: { query: "SELECT id FROM t" },
    explains: READS,
    says: "Returned 3 rows. It ran read-only, so no data changed.",
  },
  {
    id: "find-documents",
    kind: "reads",
    credentials: mongo,
    parameters: { collection: "c" },
    explains: READS,
    says: "Returned 1 document. It ran read-only, so no data changed.",
  },
  {
    id: "aggregate-documents",
    kind: "reads",
    credentials: mongo,
    parameters: { collection: "c", pipeline: [{ $match: {} }] },
    explains: READS,
    says: "Returned 2 documents. It ran read-only, so no data changed.",
  },
  {
    id: "execute-statement",
    kind: "writes",
    credentials: sql,
    parameters: { statement: "DELETE FROM t" },
    explains: WRITES,
    says: "The database reports 2 rows affected.",
  },
  {
    id: "insert-documents",
    kind: "writes",
    credentials: mongo,
    parameters: { collection: "c", documents: [{ a: 1 }] },
    explains: WRITES,
    says: "Inserted 1 document.",
  },
  {
    id: "update-documents",
    kind: "writes",
    credentials: mongo,
    parameters: {
      collection: "c",
      filter: { a: 1 },
      update: { $set: { a: 2 } },
    },
    explains: WRITES,
    says: "Matched 3 documents, changed 2.",
  },
  {
    id: "delete-documents",
    kind: "writes",
    credentials: mongo,
    parameters: { collection: "c", filter: { a: 1 } },
    explains: WRITES,
    says: "Deleted 1 document.",
  },
];

const simulated = (
  id: string,
  service: string,
  credentials: unknown,
  parameters: Record<string, unknown>,
): Case => ({
  id,
  kind: "simulated",
  credentials,
  parameters,
  explains: simulatedExplains(service),
  says: simulatedSays(service),
});

const SIMULATED: Case[] = [
  simulated("create-page", "Notion", notion, { parentId: "p", title: "t" }),
  simulated("search-content", "Notion", notion, { query: "q" }),
  simulated("update-database", "Notion", notion, {
    databaseId: "d",
    pageId: "p",
    properties: {},
  }),
  simulated("manage-blocks", "Notion", notion, {
    operation: "append",
    pageId: "p",
    blocks: [{ type: "paragraph", content: "hi" }],
  }),
  simulated("read-data", "Google Sheets", sheets, {
    spreadsheetId: "s",
    range: "A1",
  }),
  simulated("write-data", "Google Sheets", sheets, {
    spreadsheetId: "s",
    range: "A1",
    values: [["a"]],
  }),
  simulated("create-sheet", "Google Sheets", sheets, {
    spreadsheetId: "s",
    title: "t",
  }),
  simulated(
    "send-message",
    "Microsoft Teams",
    {},
    {
      webhookUrl: teamsUrl,
      message: "hi",
    },
  ),
  simulated(
    "send-card",
    "Microsoft Teams",
    {},
    {
      webhookUrl: teamsUrl,
      card: { type: "AdaptiveCard", version: "1.4", body: [] },
    },
  ),
  simulated("create-card", "Trello", trello, { listId: "l", name: "n" }),
  simulated("move-card", "Trello", trello, {
    cardId: "c",
    destinationListId: "l",
  }),
  simulated("add-checklist", "Trello", trello, { cardId: "c", name: "n" }),
];

const lookUp = (id: string) => {
  const action = getServerActionById(id);
  if (!action) throw new Error(`The server has no action ${id}`);
  return action;
};

beforeEach(() => mockOut.mockClear());

describe("what each action declares", () => {
  it("covers every action the server can run", () => {
    expect([...REAL, ...SIMULATED].map(({ id }) => id).sort()).toEqual(
      getAllServerActionIds().sort(),
    );
  });

  it.each(REAL.map((c) => [c.id, c] as const))(
    "%s really goes out when isTest is set, and says so",
    async (id, { kind, credentials, parameters, explains, says }) => {
      const action = lookUp(id);
      action.inputSchema.parse(parameters);

      const result: unknown = await action.execute(
        credentials,
        parameters,
        context(true),
      );

      expect(mockOut).toHaveBeenCalled();
      expect(isFailureResult(result)).toBe(false);
      expect(action.testRun.kind).toBe(kind);
      expect(action.testRun.explains).toBe(explains);
      expect(action.testRun.succeeded(result)).toBe(says);
    },
  );

  it.each(SIMULATED.map((c) => [c.id, c] as const))(
    "%s contacts nothing when isTest is set, and says so",
    async (id, { credentials, parameters, explains, says }) => {
      const action = lookUp(id);
      action.inputSchema.parse(parameters);

      const result: unknown = await action.execute(
        credentials,
        parameters,
        context(true),
      );

      expect(mockOut).not.toHaveBeenCalled();
      expect(isFailureResult(result)).toBe(false);
      expect(action.testRun.kind).toBe("simulated");
      expect(action.testRun.explains).toBe(explains);
      expect(action.testRun.succeeded(result)).toBe(says);

      // The stub would have seen a real run, so "nothing" above means something.
      await action.execute(credentials, parameters, context(false));
      expect(mockOut).toHaveBeenCalled();
    },
  );
});

/**
 * The form runs these without asking, because it says they change nothing. The driver's
 * transaction refuses a write for SQL (`drivers.test.ts`, and on a real server in
 * `postgres-integration.test.ts`), and it has to be the read path that gets the statement.
 */
describe("the actions that run without asking", () => {
  it("sends a query down the read path, not the one that writes", async () => {
    await lookUp("run-query").execute(
      sql,
      { query: "SELECT 1" },
      context(true),
    );
    expect(mockOut.mock.calls).toEqual([["sql:query"]]);
  });

  it("refuses a statement that isn't a read before it reaches the database", async () => {
    const result: unknown = await lookUp("run-query").execute(
      sql,
      { query: "DELETE FROM t" },
      context(true),
    );
    expect(isFailureResult(result)).toBe(true);
    expect(mockOut).not.toHaveBeenCalled();
  });

  it.each(["$out", "$merge"])(
    "refuses an aggregation that writes with %s",
    async (stage) => {
      const result: unknown = await lookUp("aggregate-documents").execute(
        mongo,
        { collection: "c", pipeline: [{ [stage]: "other" }] },
        context(true),
      );
      expect(isFailureResult(result)).toBe(true);
      expect(mockOut).not.toHaveBeenCalled();
    },
  );
});

describe("what the toast says about a result", () => {
  const says = (id: string, result: unknown) =>
    lookUp(id).testRun.succeeded(result);

  it.each([
    [0, "The database reports 0 rows affected."],
    [1, "The database reports 1 row affected."],
    [2, "The database reports 2 rows affected."],
  ])("counts %i rows from a statement", (rowCount, words) => {
    expect(says("execute-statement", { rowCount })).toBe(words);
  });

  it.each([
    [0, "Returned 0 rows. It ran read-only, so no data changed."],
    [1, "Returned 1 row. It ran read-only, so no data changed."],
  ])("counts %i rows from a query", (rowCount, words) => {
    expect(says("run-query", { rowCount })).toBe(words);
  });

  it("says how many were deleted, even none", () => {
    expect(says("delete-documents", { deletedCount: 0 })).toBe(
      "Deleted 0 documents.",
    );
  });

  it("says when an update added a document", () => {
    expect(
      says("update-documents", {
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 1,
      }),
    ).toBe("Matched 0 documents, changed 0, added 1.");
  });

  it("says which recipients the mail server refused", () => {
    expect(
      says("send-email", {
        deliveryInfo: {
          accepted: ["a@example.test", "b@example.test"],
          rejected: ["c@example.test"],
        },
      }),
    ).toBe(
      "The mail server accepted it for 2 recipients. It refused c@example.test.",
    );
  });
});
