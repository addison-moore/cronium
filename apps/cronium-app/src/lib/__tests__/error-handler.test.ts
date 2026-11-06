import { format } from "node:util";
import { TRPCError } from "@trpc/server";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { logError, toTRPCError } from "@/lib/error-handler";

const SECRET = "the-bound-value";

/** A column list like the one on any query on `events`. */
const QUERY = 'update "events" set "content" = $1 returning "timeout_value"';

const failedQuery = () =>
  new DrizzleQueryError(
    QUERY,
    [SECRET],
    Object.assign(new Error("refused"), {
      code: "P0001",
      severity: "ERROR",
      detail: SECRET,
    }),
  );

describe("toTRPCError", () => {
  it("doesn't let a failed query's text reach the client or pick the code", () => {
    const error = toTRPCError(failedQuery());

    // TIMEOUT or anything else would reach the client with its message: only this
    // code gets the production error formatter's generic one.
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe("An unexpected error occurred");
    expect(error.cause).toBeUndefined();
  });

  it("uses the code it was given for a failed query", () => {
    expect(toTRPCError(failedQuery(), "BAD_GATEWAY").code).toBe("BAD_GATEWAY");
  });

  it.each([
    ["Workflow not found", "NOT_FOUND"],
    ["unauthorized for this", "UNAUTHORIZED"],
    ["forbidden here", "FORBIDDEN"],
    ["invalid cron", "BAD_REQUEST"],
    ["timeout waiting", "TIMEOUT"],
    ["name already exists", "CONFLICT"],
    ["anything else", "INTERNAL_SERVER_ERROR"],
  ])("still reads %s as %s", (message, code) => {
    const error = toTRPCError(new Error(message));

    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });

  it("returns a tRPC error as it is", () => {
    const error = new TRPCError({ code: "CONFLICT", message: "taken" });

    expect(toTRPCError(error)).toBe(error);
  });
});

describe("logError", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("logs a failed query's SQLSTATE, message and frames, and not the query", () => {
    logError(failedQuery(), undefined, { operation: "update" });

    const [entry] = errorSpy.mock.calls[0] as [
      { message: string; stack: string; operation: string },
    ];
    expect(entry.message).toBe("P0001: refused");
    expect(entry.operation).toBe("update");
    expect(entry.stack).toMatch(/^\s+at /);

    const printed = format(entry);
    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain("Failed query");
  });

  it("logs another error's name and message", () => {
    logError(new TypeError("x is not a function"));

    const [entry] = errorSpy.mock.calls[0] as [{ message: string }];
    expect(entry.message).toBe("TypeError: x is not a function");
  });
});
