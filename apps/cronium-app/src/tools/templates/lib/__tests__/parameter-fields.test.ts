import { z } from "zod";

import {
  collectParameterErrors,
  formatEnumValue,
  formatFieldName,
  formatFieldValueForEditor,
  getEnumOptions,
  getMonacoLanguage,
  getSchemaShape,
  isEmailField,
  isMultilineField,
  parseLooseFieldValue,
  parseMonacoFieldValue,
  shouldUseMonaco,
  unwrapOptionalSchema,
} from "../parameter-fields";

describe("getSchemaShape", () => {
  it("returns the shape of a plain object schema", () => {
    const schema = z.object({ message: z.string(), count: z.number() });
    expect(Object.keys(getSchemaShape(schema))).toEqual(["message", "count"]);
  });

  it("returns the shape of a refined object schema (Zod v4 keeps ZodObject identity)", () => {
    const schema = z
      .object({ to: z.string(), cc: z.string().optional() })
      .refine(() => true, "always");
    expect(Object.keys(getSchemaShape(schema))).toEqual(["to", "cc"]);
  });

  it("returns {} for non-object schemas", () => {
    expect(getSchemaShape(z.string())).toEqual({});
  });

  it("does NOT unwrap piped object schemas under Zod v4 (pinned quirk)", () => {
    // The unwrap loop matches _def.typeName === "ZodPipeline", which only
    // existed in Zod v3 — under v4 a piped object yields no fields.
    const schema = z
      .object({ a: z.string() })
      .pipe(z.object({ a: z.string() }));
    expect(getSchemaShape(schema)).toEqual({});
  });
});

describe("collectParameterErrors (required-field validation)", () => {
  const schema = z.object({
    message: z.string().min(1, "Message content is required"),
    channel: z.string().optional(),
  });

  it("returns an empty object when the value is valid", () => {
    expect(collectParameterErrors(schema, { message: "hi" })).toEqual({});
  });

  it("keys missing required fields by name with the custom message", () => {
    const errors = collectParameterErrors(schema, { message: "" });
    expect(errors).toEqual({ message: "Message content is required" });
  });

  it("reports missing required fields and ignores satisfied optionals", () => {
    const errors = collectParameterErrors(schema, {});
    expect(Object.keys(errors)).toEqual(["message"]);
    expect(typeof errors.message).toBe("string");
    expect(errors.message!.length).toBeGreaterThan(0);
  });

  it("joins nested error paths with dots", () => {
    const nested = z.object({ outer: z.object({ inner: z.string() }) });
    const errors = collectParameterErrors(nested, { outer: {} });
    expect(Object.keys(errors)).toEqual(["outer.inner"]);
  });
});

describe("shouldUseMonaco", () => {
  it("is true when the description mentions json or html", () => {
    expect(shouldUseMonaco("payload", z.string().describe("JSON body"))).toBe(
      true,
    );
    expect(shouldUseMonaco("body", z.string().describe("HTML content"))).toBe(
      true,
    );
  });

  it("is true for json/html/blocks/embeds field names", () => {
    expect(shouldUseMonaco("rawJson", z.string())).toBe(true);
    expect(shouldUseMonaco("htmlBody", z.string())).toBe(true);
    expect(shouldUseMonaco("blocks", z.string())).toBe(true);
    expect(shouldUseMonaco("embeds", z.string())).toBe(true);
  });

  it("is true for object and array schemas", () => {
    expect(shouldUseMonaco("data", z.object({}))).toBe(true);
    expect(shouldUseMonaco("items", z.array(z.string()))).toBe(true);
  });

  it("is false for a plain string field", () => {
    expect(shouldUseMonaco("channel", z.string())).toBe(false);
    // "body" alone (without an html description) is not a Monaco field
    expect(shouldUseMonaco("body", z.string())).toBe(false);
  });
});

describe("getMonacoLanguage", () => {
  it("returns html for html-named fields", () => {
    expect(getMonacoLanguage("htmlBody", z.string())).toBe("html");
  });

  it("returns html for body fields described as html", () => {
    expect(getMonacoLanguage("body", z.string().describe("HTML email"))).toBe(
      "html",
    );
  });

  it("defaults to json", () => {
    expect(getMonacoLanguage("blocks", z.string())).toBe("json");
    expect(getMonacoLanguage("body", z.string())).toBe("json");
  });
});

describe("unwrapOptionalSchema", () => {
  it("unwraps a top-level optional", () => {
    const { baseSchema, isOptional } = unwrapOptionalSchema(
      z.string().optional(),
    );
    expect(isOptional).toBe(true);
    expect(baseSchema).toBeInstanceOf(z.ZodString);
  });

  it("passes non-optional schemas through", () => {
    const schema = z.number();
    const { baseSchema, isOptional } = unwrapOptionalSchema(schema);
    expect(isOptional).toBe(false);
    expect(baseSchema).toBe(schema);
  });
});

describe("isEmailField", () => {
  it("detects email fields by name", () => {
    expect(isEmailField("email", z.string())).toBe(true);
    expect(isEmailField("replyToEmail", z.string())).toBe(true);
  });

  it("does NOT detect z.string().email() by schema under Zod v4 (pinned quirk)", () => {
    // The `_def.checks` probe looks for a v3-style `{ kind: "email" }` check
    // that no longer exists in v4 — only the field name matters today.
    expect(isEmailField("recipient", z.string().email())).toBe(false);
  });

  it("is false for ordinary string fields", () => {
    expect(isEmailField("subject", z.string())).toBe(false);
  });
});

describe("isMultilineField", () => {
  it.each(["body", "content", "message", "description", "textBlock"])(
    "treats %s as multiline",
    (key) => {
      expect(isMultilineField(key)).toBe(true);
    },
  );

  it("is false for short fields", () => {
    expect(isMultilineField("subject")).toBe(false);
    expect(isMultilineField("channel")).toBe(false);
  });
});

describe("getEnumOptions", () => {
  it("lists enum values in declaration order", () => {
    expect(getEnumOptions(z.enum(["low", "medium", "high"]))).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });
});

describe("formatFieldValueForEditor", () => {
  it("pretty-prints objects and arrays", () => {
    expect(formatFieldValueForEditor({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatFieldValueForEditor([1, 2])).toBe("[\n  1,\n  2\n]");
  });

  it("passes strings through and coerces other scalars", () => {
    expect(formatFieldValueForEditor("hello")).toBe("hello");
    expect(formatFieldValueForEditor(5)).toBe("5");
    expect(formatFieldValueForEditor(false)).toBe("false");
  });

  it("renders nullish values as an empty string", () => {
    expect(formatFieldValueForEditor(null)).toBe("");
    expect(formatFieldValueForEditor(undefined)).toBe("");
  });
});

describe("parseMonacoFieldValue", () => {
  it("parses valid JSON in json mode", () => {
    expect(parseMonacoFieldValue("json", '{"a":1}')).toEqual({ a: 1 });
  });

  it("treats empty input as an empty object in json mode", () => {
    expect(parseMonacoFieldValue("json", "")).toEqual({});
  });

  it("falls back to the raw string for invalid JSON", () => {
    expect(parseMonacoFieldValue("json", "{oops")).toBe("{oops");
  });

  it("parses scalar JSON to a scalar in json mode (pinned quirk)", () => {
    expect(parseMonacoFieldValue("json", "5")).toBe(5);
  });

  it("passes html values through untouched", () => {
    expect(parseMonacoFieldValue("html", '{"a":1}')).toBe('{"a":1}');
  });
});

describe("parseLooseFieldValue", () => {
  it("parses valid JSON", () => {
    expect(parseLooseFieldValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseLooseFieldValue("5")).toBe(5);
  });

  it("keeps plain text (and empty input) as the raw string", () => {
    expect(parseLooseFieldValue("hello")).toBe("hello");
    expect(parseLooseFieldValue("")).toBe("");
  });
});

describe("formatFieldName", () => {
  it("title-cases snake_case and camelCase keys", () => {
    expect(formatFieldName("smtp_host")).toBe("Smtp Host");
    expect(formatFieldName("webhookUrl")).toBe("Webhook Url");
    expect(formatFieldName("body")).toBe("Body");
  });
});

describe("formatEnumValue", () => {
  it("title-cases snake and kebab enum values", () => {
    expect(formatEnumValue("send_message")).toBe("Send Message");
    expect(formatEnumValue("verify-full")).toBe("Verify Full");
  });
});
