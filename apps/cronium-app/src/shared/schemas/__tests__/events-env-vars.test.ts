/**
 * @jest-environment node
 */

import {
  createEventSchema,
  envVarSchema,
  envVarsSchema,
  legacyEventPatchSchema,
  MAX_ENV_VAR_KEY_LENGTH,
  MAX_ENV_VAR_VALUE_BYTES,
  MAX_ENV_VARS,
  MAX_ENV_VARS_TOTAL_BYTES,
  updateEventSchema,
} from "../events";
import { EventType } from "@/shared/schema";

const messagesFor = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => result.error?.issues.map((issue) => issue.message) ?? [];

const tooLongValue = "x".repeat(MAX_ENV_VAR_VALUE_BYTES + 1);

describe("one environment variable", () => {
  it("takes a value up to the limit, and refuses one byte more", () => {
    const at = "x".repeat(MAX_ENV_VAR_VALUE_BYTES);
    expect(envVarSchema.safeParse({ key: "K", value: at }).success).toBe(true);

    const over = envVarSchema.safeParse({ key: "K", value: tooLongValue });
    expect(over.success).toBe(false);
    expect(messagesFor(over)[0]).toContain("at most 128 KB");
  });

  // The kernel counts bytes. A limit on characters would pass these to a job that
  // can't start.
  it.each([
    ["two-byte", "é", 2],
    ["three-byte", "日", 3],
    ["four-byte", "🙂", 4],
  ])("counts %s characters as bytes", (_label, character, bytes) => {
    const fitting = Math.floor(MAX_ENV_VAR_VALUE_BYTES / bytes);
    expect(
      envVarSchema.safeParse({ key: "K", value: character.repeat(fitting) })
        .success,
    ).toBe(true);
    expect(
      envVarSchema.safeParse({
        key: "K",
        value: character.repeat(fitting + 1),
      }).success,
    ).toBe(false);
  });

  it("takes an empty value", () => {
    expect(envVarSchema.safeParse({ key: "K", value: "" }).success).toBe(true);
  });

  it("requires a key, and refuses one the column can't hold", () => {
    expect(messagesFor(envVarSchema.safeParse({ key: "", value: "" }))).toEqual(
      ["Environment variable key is required"],
    );

    const at = "K".repeat(MAX_ENV_VAR_KEY_LENGTH);
    expect(envVarSchema.safeParse({ key: at, value: "" }).success).toBe(true);
    expect(
      messagesFor(envVarSchema.safeParse({ key: `${at}K`, value: "" })),
    ).toEqual(["An environment variable key can be at most 255 characters"]);
  });
});

describe("a NUL character", () => {
  it("is refused in a key, which Postgres can't store", () => {
    expect(
      messagesFor(envVarSchema.safeParse({ key: "A\0B", value: "" })),
    ).toEqual(["An environment variable key can't contain a NUL character"]);
  });

  it("is refused in a value, which a process can't be given", () => {
    expect(
      messagesFor(envVarSchema.safeParse({ key: "K", value: "a\0b" })),
    ).toEqual(["An environment variable value can't contain a NUL character"]);
  });

  it("leaves line breaks alone", () => {
    const pem = "-----BEGIN KEY-----\r\nabc\n-----END KEY-----\n";
    expect(envVarSchema.parse({ key: "K", value: pem }).value).toBe(pem);
  });
});

describe("an event's environment variables together", () => {
  /** Variables whose keys and values come to exactly `total` bytes. */
  function variablesTotalling(total: number) {
    const variables: { key: string; value: string }[] = [];
    for (let left = total, n = 0; left > 0; n += 1) {
      const key = `K${n}`;
      const value = "x".repeat(
        Math.min(left - key.length, MAX_ENV_VAR_VALUE_BYTES),
      );
      variables.push({ key, value });
      left -= key.length + value.length;
    }
    return variables;
  }

  it("takes up to the limit, and refuses one byte more", () => {
    expect(
      envVarsSchema.safeParse(variablesTotalling(MAX_ENV_VARS_TOTAL_BYTES))
        .success,
    ).toBe(true);

    const over = envVarsSchema.safeParse(
      variablesTotalling(MAX_ENV_VARS_TOTAL_BYTES + 1),
    );
    expect(over.success).toBe(false);
    expect(messagesFor(over)[0]).toContain("at most 1 MB in total");
  });

  it("takes up to the most variables, and refuses one more", () => {
    const variables = (count: number) =>
      Array.from({ length: count }, (_, n) => ({ key: `K${n}`, value: "v" }));

    expect(envVarsSchema.safeParse(variables(MAX_ENV_VARS)).success).toBe(true);
    expect(
      messagesFor(envVarsSchema.safeParse(variables(MAX_ENV_VARS + 1))),
    ).toEqual(["An event can have at most 1,000 environment variables"]);
  });
});

describe("the limits against what Linux refuses", () => {
  // Measured in the runner images and through the runner on Linux, with an 8 MiB stack.
  const LONGEST_STRING = 131_072;
  const LONGEST_ENVIRONMENT = 2 * 1024 * 1024;
  // What each variable costs exec beyond its key and value: `=`, NUL and a pointer.
  const OVERHEAD_PER_VARIABLE = 1 + 1 + 8;

  it("always fits `KEY=value` and its NUL, whatever the key", () => {
    const longestKeyBytes = MAX_ENV_VAR_KEY_LENGTH * 3;
    expect(longestKeyBytes + 1 + MAX_ENV_VAR_VALUE_BYTES + 1).toBeLessThan(
      LONGEST_STRING,
    );
  });

  it("leaves half of what exec takes for the rest of a process's environment and arguments", () => {
    const mostAnEventCanUse =
      MAX_ENV_VARS_TOTAL_BYTES + MAX_ENV_VARS * OVERHEAD_PER_VARIABLE;

    expect(mostAnEventCanUse).toBeLessThan(LONGEST_ENVIRONMENT / 2);
  });
});

describe("the schemas that take environment variables", () => {
  const event = {
    name: "e",
    type: EventType.BASH,
    content: "echo hi",
  };
  const tooLong = [{ key: "K", value: tooLongValue }];

  it.each([
    ["creating an event", createEventSchema, event],
    ["updating an event", updateEventSchema, { id: 1 }],
    ["the REST patch", legacyEventPatchSchema, {}],
  ])("%s refuses a value over the limit", (_label, schema, base) => {
    expect(schema.safeParse(base).success).toBe(true);

    const result = schema.safeParse({ ...base, envVars: tooLong });
    expect(result.success).toBe(false);
    expect(messagesFor(result)[0]).toContain("at most 128 KB");
  });
});
