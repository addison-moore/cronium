import { TRPCError } from "@trpc/server";
import { DrizzleQueryError } from "drizzle-orm/errors";
import {
  describeFailure,
  driverError,
  failureWithStack,
  isQueryFailure,
  pgErrorCode,
  stackFrames,
} from "@/lib/pg-errors";

const SECRET = "the-bound-value";

/** The driver's error as Postgres sends it, with the fields that quote a value. */
const postgresError = (message: string, code = "23505") =>
  Object.assign(new Error(message), {
    code,
    severity: "ERROR",
    detail: `Key (email)=(${SECRET}) already exists.`,
    where: `JSON data, line 1: ${SECRET}`,
  });

const failedQuery = (cause: unknown, params: unknown[] = [SECRET]) =>
  new DrizzleQueryError("insert into t values ($1)", params, cause as Error);

describe("pgErrorCode", () => {
  it("reads the SQLSTATE from the driver's error inside Drizzle's wrapper", () => {
    const cause = Object.assign(new Error("duplicate key"), { code: "23505" });

    expect(pgErrorCode(new DrizzleQueryError("insert", [], cause))).toBe(
      "23505",
    );
  });

  it("reads an error that isn't wrapped", () => {
    expect(pgErrorCode(Object.assign(new Error("x"), { code: "23503" }))).toBe(
      "23503",
    );
  });

  it.each([[new Error("no code")], [null], [undefined], ["text"]])(
    "has no code for %s",
    (error) => {
      expect(pgErrorCode(error)).toBeUndefined();
    },
  );
});

describe("driverError", () => {
  it("reads through tRPC's wrapper as well as Drizzle's", () => {
    const wrapped = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: failedQuery(postgresError("duplicate key")),
    });

    expect(driverError(wrapped).message).toBe("duplicate key");
    expect(pgErrorCode(wrapped)).toBe("23505");
  });

  it("stops at the last error that says anything, as a plain cause on tRPC's is blank", () => {
    const wrapped = new TRPCError({
      code: "BAD_REQUEST",
      message: "name: too long",
      cause: { field: "name", value: SECRET },
    });

    expect(driverError(wrapped).message).toBe("name: too long");
  });

  it("stops on a cycle", () => {
    const error = new Error("mine") as Error & { cause?: unknown };
    error.cause = error;

    expect(driverError(error).message).toBe("mine");
  });

  it("returns the wrapped error, whose message doesn't repeat the query's values", () => {
    const cause = Object.assign(new Error("relation does not exist"), {
      code: "42P01",
      severity: "ERROR",
    });

    const inner = driverError(
      new DrizzleQueryError("insert", ["secret"], cause),
    );

    expect(inner).toMatchObject({ code: "42P01", severity: "ERROR" });
    expect(inner.message).toBe("relation does not exist");
  });

  it("returns an error with no cause as it is", () => {
    const error = new TypeError("Do not know how to serialize a BigInt");

    expect(driverError(error)).toBe(error);
  });
});

describe("describeFailure", () => {
  const cause = Object.assign(new Error("value too long"), { code: "22001" });

  it("gives the driver's code and message, without the query's values", () => {
    const wrapped = new DrizzleQueryError(
      "insert into t values ($1)",
      ["a secret value"],
      cause,
    );

    // The premise: Drizzle's own message holds them.
    expect(wrapped.message).toContain("a secret value");
    expect(describeFailure(wrapped)).toBe("22001: value too long");
  });

  it("describes an error with no code by its name", () => {
    expect(describeFailure(new TypeError("cannot encode"))).toBe(
      "TypeError: cannot encode",
    );
  });

  it("is the SQLSTATE and the driver's message, and nothing of the wrapper's", () => {
    expect(describeFailure(failedQuery(postgresError("duplicate key")))).toBe(
      "23505: duplicate key",
    );
  });

  it("reads through tRPC, whose own message repeats Drizzle's", () => {
    const wrapped = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: failedQuery(postgresError("duplicate key")),
    });
    expect(wrapped.message).toContain(SECRET);

    expect(describeFailure(wrapped)).toBe("23505: duplicate key");
  });

  it("names an error that isn't a query's", () => {
    expect(describeFailure(new TypeError("x is not a function"))).toBe(
      "TypeError: x is not a function",
    );
  });

  it("uses a Node error's code", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });

    expect(describeFailure(failedQuery(error))).toBe(
      "ECONNREFUSED: connect ECONNREFUSED",
    );
  });

  it.each([
    ["no cause", failedQuery(undefined), "Error: [query not logged]"],
    [
      "a cause that isn't an error",
      failedQuery("text"),
      "Error: [query not logged]",
    ],
    [
      "a message built from Drizzle's",
      new Error(`Retry failed: ${failedQuery(new Error("x")).message}`),
      "Error: Retry failed: [query not logged]",
    ],
  ])("leaves out the query with %s", (_, error, expected) => {
    expect(describeFailure(error)).toBe(expected);
  });

  it("replaces a bound value the driver's message quotes", () => {
    const error = failedQuery(
      postgresError(
        `invalid input syntax for type integer: "${SECRET}"`,
        "22P02",
      ),
    );

    expect(describeFailure(error)).toBe(
      '22P02: invalid input syntax for type integer: "[value]"',
    );
  });

  it("replaces a longer value before one it contains", () => {
    const error = failedQuery(postgresError(`refused ${SECRET}-and-more`), [
      SECRET,
      `${SECRET}-and-more`,
    ]);

    expect(describeFailure(error)).toBe("23505: refused [value]");
  });

  it("keeps a short value, which is likelier to be a word of the message", () => {
    const error = failedQuery(postgresError("null value in column"), ["null"]);

    expect(describeFailure(error)).toBe("23505: null value in column");
  });

  it("doesn't quote JSON.parse, whose message holds what it couldn't parse", () => {
    let error: unknown;
    try {
      JSON.parse(SECRET);
    } catch (caught) {
      error = caught;
    }
    expect((error as Error).message).toContain(SECRET);

    const line = describeFailure(error);

    expect(line).not.toContain(SECRET);
    expect(line).toContain("SyntaxError");
  });

  it("masks a secret and stays on one short line, as it can't match every quoted form", () => {
    const line = describeFailure(
      new Error(`Bearer abcdefghijklmnop\nforged line ${"x".repeat(1000)}`),
    );

    expect(line).not.toContain("abcdefghijklmnop");
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThanOrEqual(500);
  });

  it.each([
    ["text", "Error: text"],
    [undefined, "Error: undefined"],
    [null, "Error: null"],
  ])("describes %s, which can be thrown too", (thrown, expected) => {
    expect(describeFailure(thrown)).toBe(expected);
  });
});

describe("stackFrames", () => {
  it("has frames and none of the message, even a line of it that looks like one", () => {
    const value = `${SECRET}\n    at looks.like.a.frame (${SECRET})`;
    const wrapper = failedQuery(undefined, [value]);

    const frames = stackFrames(wrapper);

    expect(wrapper.stack).toContain(SECRET);
    expect(frames).not.toContain(SECRET);
    expect(frames).toMatch(/^\s+at /);
  });

  it("uses the deepest error's stack", () => {
    const cause = postgresError("duplicate key");
    cause.stack = `error: duplicate key\n    at the.driver (driver.js:1:1)`;

    expect(stackFrames(failedQuery(cause))).toBe(
      "    at the.driver (driver.js:1:1)",
    );
  });

  it("leaves out a stack whose message changed after it was captured", () => {
    const cause = new Error(`first ${SECRET}\n    at ${SECRET}`);
    // V8 fixes the text when this is first read, which a logger may have done.
    expect(cause.stack).toContain(SECRET);
    cause.message = "second";

    expect(stackFrames(cause)).toBe("");
  });

  it("has nothing for what isn't an error", () => {
    expect(stackFrames("text")).toBe("");
    expect(stackFrames({ message: "no stack" })).toBe("");
  });
});

describe("failureWithStack", () => {
  it("is the line, then the frames", () => {
    const [line, ...frames] = failureWithStack(
      failedQuery(postgresError("duplicate key")),
    ).split("\n");

    expect(line).toBe("23505: duplicate key");
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.every((frame) => /^\s+at /.test(frame))).toBe(true);
  });

  it("is just the line when there's no stack", () => {
    expect(failureWithStack("text")).toBe("Error: text");
  });
});

describe("isQueryFailure", () => {
  it.each([
    ["Drizzle's wrapper", failedQuery(new Error("x"))],
    ["a wrapper with no cause", failedQuery(undefined)],
    [
      "tRPC's wrapper around it",
      new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        cause: failedQuery(new Error("x")),
      }),
    ],
    ["an error Postgres sent directly", postgresError("duplicate key")],
    ["a message built from Drizzle's", new Error("Failed query: select 1")],
  ])("is true of %s", (_, error) => {
    expect(isQueryFailure(error)).toBe(true);
  });

  it.each([
    ["an ordinary error", new Error("Workflow not found")],
    ["a tRPC error of its own", new TRPCError({ code: "NOT_FOUND" })],
    ["text", "text"],
    ["nothing", undefined],
  ])("is false of %s", (_, error) => {
    expect(isQueryFailure(error)).toBe(false);
  });
});
