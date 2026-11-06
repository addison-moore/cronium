import { DrizzleQueryError } from "drizzle-orm/errors";
import { describeFailure, driverError, pgErrorCode } from "@/lib/pg-errors";

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
});
