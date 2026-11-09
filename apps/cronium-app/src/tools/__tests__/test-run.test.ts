/**
 * @jest-environment node
 *
 * The event form's button runs an action with `isTest: true`, and that only stops an
 * action whose code reads it. Each action declares which it is in `testRun`, and the form
 * goes by that: whether to ask first, what the button says, what the toast says. A wrong
 * declaration tells someone that a delete is a simulation, so these run the real actions
 * with only their ways out of this process replaced, and compare what they do with what
 * they say.
 *
 * A few actions also declare a check, which the form offers beside the real run and the
 * server runs with `isTest`. A check that reached the real path would delete, send or
 * post under a button saying it changes nothing, so these hold each check to the one call
 * it declares.
 */
const mockOut = jest.fn<void, [string, unknown?]>();

/** Discord answers a GET on a webhook with the webhook, token and all. */
const DISCORD_WEBHOOK = {
  id: "1",
  type: 1,
  name: "Cronium Alerts",
  channel_id: "2",
  guild_id: "3",
  token: "the-webhook-token",
};

/** What each service answers a real run with, as far as the actions read it. */
function mockAnswer(tool: string, method: string): Response {
  switch (tool) {
    case "slack":
      return new Response("ok");
    case "teams":
      return new Response("1");
    case "discord":
      return new Response(
        JSON.stringify(method === "GET" ? DISCORD_WEBHOOK : { id: "1" }),
      );
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
      get: (_target, tool: string) => (_url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        mockOut(`fetch:${tool}:${method}`);
        return Promise.resolve(mockAnswer(tool, method));
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
  updateDocuments: (_credentials: unknown, input: unknown) => {
    mockOut("mongo:update", input);
    return Promise.resolve({
      matchedCount: 3,
      modifiedCount: 2,
      upsertedCount: 0,
    });
  },
  deleteDocuments: (_credentials: unknown, input: unknown) => {
    mockOut("mongo:delete", input);
    return Promise.resolve({ deletedCount: 1 });
  },
  countMatchingDocuments: (_credentials: unknown, input: unknown) => {
    mockOut("mongo:count", input);
    return Promise.resolve(3);
  },
}));

jest.mock("@/lib/email", () => ({
  sendEmailDetailed: (_message: unknown, smtp: unknown) => {
    mockOut("smtp:send", smtp);
    return Promise.resolve({
      messageId: "m",
      accepted: ["a@example.test"],
      rejected: [],
    });
  },
  checkSmtpLogin: (smtp: unknown) => {
    mockOut("smtp:login", smtp);
    return Promise.resolve({ signedIn: true });
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
];

/** An action whose real run does something, with a check the form offers beside it. */
interface CheckedCase extends Case {
  /** The one call the real run makes. */
  runs: string;
  /** The one call the check makes instead. */
  checks: string;
  label: string;
  checkExplains: string;
  /** What the real run does, finishing "<its button> ...", beside the check's line. */
  runDoes: string;
  checkSays: string;
}

const MONGO_WRITES = "really changes your data, and can't be undone";

const CHECKED: CheckedCase[] = [
  {
    id: "update-documents",
    kind: "writes",
    credentials: mongo,
    parameters: {
      collection: "c",
      filter: { a: 1 },
      update: { $set: { a: 2 } },
      many: true,
    },
    explains: `This ${MONGO_WRITES}.`,
    says: "Matched 3 documents, changed 2.",
    runs: "mongo:update",
    checks: "mongo:count",
    label: "Count Matches",
    checkExplains:
      "Count Matches says how many documents the filter matches, and changes nothing. It doesn't try the update.",
    runDoes: MONGO_WRITES,
    checkSays:
      "3 documents match the filter. Nothing was changed, so this doesn't show that the update would be accepted.",
  },
  {
    id: "delete-documents",
    kind: "writes",
    credentials: mongo,
    parameters: { collection: "c", filter: { a: 1 }, many: true },
    explains: `This ${MONGO_WRITES}.`,
    says: "Deleted 1 document.",
    runs: "mongo:delete",
    checks: "mongo:count",
    label: "Count Matches",
    checkExplains:
      "Count Matches says how many documents the filter matches, and deletes nothing.",
    runDoes: MONGO_WRITES,
    checkSays:
      "3 documents match the filter. Nothing was deleted, so this doesn't show that the delete would be allowed.",
  },
  {
    id: "send-email",
    kind: "sends",
    credentials: smtp,
    parameters: { to: "a@example.test", subject: "s", body: "b" },
    explains: "This really sends the email.",
    says: "The mail server accepted it for 1 recipient.",
    runs: "smtp:send",
    checks: "smtp:login",
    label: "Check Login",
    checkExplains:
      "Check Login signs in to the mail server, and sends nothing.",
    runDoes: "really sends the email",
    checkSays:
      "smtp.example.test accepted the login. Nothing was sent, so this doesn't show that the email would be delivered.",
  },
  {
    id: "discord-send-message",
    kind: "sends",
    credentials: discord,
    parameters: { content: "hi" },
    explains: "This really posts to Discord.",
    says: "Discord accepted the message.",
    runs: "fetch:discord:POST",
    checks: "fetch:discord:GET",
    label: "Check Webhook",
    checkExplains:
      "Check Webhook asks Discord whether the webhook exists, and posts nothing.",
    runDoes: "really posts to Discord",
    checkSays:
      "The webhook Cronium Alerts exists. Nothing was posted, so this doesn't show that Discord would accept the message.",
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

/** The calls out of this process so far, by name. */
const calledOut = () => mockOut.mock.calls.map(([name]) => name);

/** What a run answered, or what it threw, as the router sees either. */
const outcome = (run: Promise<unknown>): Promise<unknown> =>
  run.catch((error: unknown) => ({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  }));

describe("what each action declares", () => {
  it("covers every action the server can run", () => {
    expect(
      [...REAL, ...CHECKED, ...SIMULATED].map(({ id }) => id).sort(),
    ).toEqual(getAllServerActionIds().sort());
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
      // Nothing here stops at `isTest`, so a check would be a real run.
      expect(action.testRun.check).toBeUndefined();
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
      expect(action.testRun.check).toBeUndefined();

      // The stub would have seen a real run, so "nothing" above means something.
      await action.execute(credentials, parameters, context(false));
      expect(mockOut).toHaveBeenCalled();
    },
  );

  it.each(CHECKED.map((c) => [c.id, c] as const))(
    "%s only checks when isTest is set, never reaching the real run's path",
    async (
      id,
      {
        credentials,
        parameters,
        checks,
        label,
        checkExplains,
        runDoes,
        checkSays,
      },
    ) => {
      const action = lookUp(id);
      action.inputSchema.parse(parameters);

      const result: unknown = await action.execute(
        credentials,
        parameters,
        context(true),
      );

      expect(calledOut()).toEqual([checks]);
      expect(isFailureResult(result)).toBe(false);
      expect(action.testRun.check).toMatchObject({
        label,
        explains: checkExplains,
        runDoes,
      });
      expect(action.testRun.check?.succeeded(result)).toBe(checkSays);
    },
  );

  it.each(CHECKED.map((c) => [c.id, c] as const))(
    "%s really goes out when isTest isn't set, and says so",
    async (id, { kind, credentials, parameters, runs, explains, says }) => {
      const action = lookUp(id);

      const result: unknown = await action.execute(
        credentials,
        parameters,
        context(false),
      );

      expect(calledOut()).toEqual([runs]);
      expect(isFailureResult(result)).toBe(false);
      expect(action.testRun.kind).toBe(kind);
      expect(action.testRun.explains).toBe(explains);
      expect(action.testRun.succeeded(result)).toBe(says);
    },
  );
});

/**
 * A check has to reach what the real run would: the same collection and filter, the same
 * mail server with the same settings. One that differed could pass where the run fails,
 * or count other documents.
 */
describe("a check aims where the real run would", () => {
  it.each([
    [
      "delete-documents",
      { collection: "orders", filter: '{"status":"open"}', many: true },
      "mongo:delete",
    ],
    [
      "update-documents",
      {
        collection: "orders",
        filter: '{"status":"open"}',
        update: '{"$set":{"status":"done"}}',
      },
      "mongo:update",
    ],
  ])(
    "%s counts with the collection and filter the real run uses",
    async (id, parameters, runs) => {
      const action = lookUp(id);
      await action.execute(mongo, parameters, context(true));
      await action.execute(mongo, parameters, context(false));

      const [[checked, counted], [ran, used]] = mockOut.mock.calls as [
        [string, Record<string, unknown>],
        [string, Record<string, unknown>],
      ];
      expect([checked, ran]).toEqual(["mongo:count", runs]);
      expect(counted).toEqual({
        collection: "orders",
        filter: { status: "open" },
      });
      expect(used).toMatchObject(counted);
    },
  );

  it("signs in to the mail server the send would use, with the same settings", async () => {
    const action = lookUp("send-email");
    const parameters = { to: "a@example.test", subject: "s", body: "b" };
    const credentials = { ...smtp, fromName: "Ops", enableSSL: true };
    await action.execute(credentials, parameters, context(true));
    await action.execute(credentials, parameters, context(false));

    const [[, checked], [, sent]] = mockOut.mock.calls;
    expect(checked).toEqual(sent);
    expect(checked).toMatchObject({
      host: "smtp.example.test",
      port: 587,
      user: "u",
      password: "p",
      fromEmail: "from@example.test",
      fromName: "Ops",
      secure: true,
    });
  });

  it("keeps the webhook's token out of what a Discord check answers", async () => {
    const result: unknown = await lookUp("discord-send-message").execute(
      discord,
      { content: "hi" },
      context(true),
    );

    expect(JSON.stringify(result)).not.toContain(DISCORD_WEBHOOK.token);
  });
});

/** A check that passed where the real run would refuse would say something untrue. */
describe("a check refuses what the real run refuses, before contacting anything", () => {
  it.each<[string, string, unknown, Record<string, unknown>]>([
    [
      "a delete with an empty filter",
      "delete-documents",
      mongo,
      { collection: "c", filter: "{}" },
    ],
    [
      "an update of many with an empty filter",
      "update-documents",
      mongo,
      { collection: "c", filter: "{}", update: { $set: { a: 1 } }, many: true },
    ],
    [
      "an update with nothing to change",
      "update-documents",
      mongo,
      { collection: "c", filter: { a: 1 }, update: "{}" },
    ],
    [
      "a filter that isn't JSON",
      "delete-documents",
      mongo,
      { collection: "c", filter: "{not json" },
    ],
    [
      "embeds that aren't JSON",
      "discord-send-message",
      discord,
      { embeds: "[{not json" },
    ],
    [
      "a mail credential with no password",
      "send-email",
      { ...smtp, smtpPassword: "" },
      { to: "a@example.test", subject: "s", body: "b" },
    ],
  ])("%s", async (_, id, credentials, parameters) => {
    const action = lookUp(id);
    const checked = await outcome(
      action.execute(credentials, parameters, context(true)),
    );
    const ran = await outcome(
      action.execute(credentials, parameters, context(false)),
    );

    expect(isFailureResult(checked)).toBe(true);
    expect(checked).toEqual(ran);
    expect(mockOut).not.toHaveBeenCalled();
  });
});

describe("what the toast says after a check", () => {
  const says = (id: string, result: unknown) =>
    lookUp(id).testRun.check?.succeeded(result);
  const NOT_DELETED =
    "Nothing was deleted, so this doesn't show that the delete would be allowed.";
  const NOT_CHANGED =
    "Nothing was changed, so this doesn't show that the update would be accepted.";

  it.each<[string, Record<string, unknown>, string]>([
    [
      "all of them, with Many",
      { matchedCount: 3, many: true },
      `3 documents match the filter. ${NOT_DELETED}`,
    ],
    [
      "only the first, without Many",
      { matchedCount: 3, many: false },
      `3 documents match the filter, but without Many only the first would be deleted. ${NOT_DELETED}`,
    ],
    [
      "the one",
      { matchedCount: 1, many: false },
      `1 document matches the filter. ${NOT_DELETED}`,
    ],
    [
      "none",
      { matchedCount: 0, many: true },
      `No documents match the filter. ${NOT_DELETED}`,
    ],
  ])("says a delete would take %s", (_, result, words) => {
    expect(says("delete-documents", result)).toBe(words);
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      "all of them, with Many",
      { matchedCount: 2, many: true, upsert: false },
      `2 documents match the filter. ${NOT_CHANGED}`,
    ],
    [
      "only the first, without Many",
      { matchedCount: 2, many: false, upsert: false },
      `2 documents match the filter, but without Many only the first would be updated. ${NOT_CHANGED}`,
    ],
    [
      "a new one, with Upsert and no match",
      { matchedCount: 0, many: false, upsert: true },
      `No documents match the filter, so Upsert would add one. ${NOT_CHANGED}`,
    ],
    [
      "none",
      { matchedCount: 0, many: false, upsert: false },
      `No documents match the filter. ${NOT_CHANGED}`,
    ],
  ])("says an update would touch %s", (_, result, words) => {
    expect(says("update-documents", result)).toBe(words);
  });

  it("says when the mail server never asked for a login", () => {
    expect(
      says("send-email", { host: "smtp.example.test", signedIn: false }),
    ).toBe(
      "smtp.example.test answered, and didn't ask for a login. Nothing was sent, so this doesn't show that the email would be delivered.",
    );
  });

  it("doesn't name a webhook that has no name", () => {
    expect(says("discord-send-message", { webhookName: null })).toBe(
      "The webhook exists. Nothing was posted, so this doesn't show that Discord would accept the message.",
    );
  });
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
