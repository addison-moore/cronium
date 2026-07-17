/**
 * @jest-environment node
 */
import {
  assertNonEmptyFilterForMany,
  assertReadOnlyPipeline,
  buildMongoUri,
  coerceJsonDocuments,
  coerceJsonObject,
  coercePipeline,
  createDocumentAccumulator,
  normalizeBooleanFields,
  toJsonSafeBson,
} from "../mongo-helpers";
import type { MongoCredentials } from "../schemas";

const baseCreds: MongoCredentials = {
  scheme: "mongodb",
  host: "db.example.com",
  database: "app",
  user: "reader",
  password: "s3cret",
  tls: "default",
};

describe("buildMongoUri", () => {
  it("builds a standard URI with the default port", () => {
    expect(buildMongoUri(baseCreds)).toBe(
      "mongodb://reader:s3cret@db.example.com:27017/app",
    );
  });

  it("URI-encodes user and password", () => {
    expect(
      buildMongoUri({ ...baseCreds, user: "a@b", password: "p:@/w?" }),
    ).toBe("mongodb://a%40b:p%3A%40%2Fw%3F@db.example.com:27017/app");
  });

  it("omits credentials when no user is set", () => {
    expect(buildMongoUri({ ...baseCreds, user: "", password: "" })).toBe(
      "mongodb://db.example.com:27017/app",
    );
  });

  it("uses an explicit port", () => {
    expect(buildMongoUri({ ...baseCreds, port: 27018 })).toContain(":27018/");
  });

  it("never appends a port to an SRV host", () => {
    const uri = buildMongoUri({
      ...baseCreds,
      scheme: "mongodb+srv",
      host: "cluster0.example.mongodb.net",
      port: 27018,
    });
    expect(uri).toBe(
      "mongodb+srv://reader:s3cret@cluster0.example.mongodb.net/app",
    );
  });

  it("leaves replica-set host lists verbatim", () => {
    const uri = buildMongoUri({ ...baseCreds, host: "h1:27017,h2:27018" });
    expect(uri).toContain("@h1:27017,h2:27018/app");
  });

  it("adds authSource and tls query params", () => {
    const uri = buildMongoUri({
      ...baseCreds,
      authSource: "admin",
      tls: "enable",
    });
    expect(uri).toContain("?authSource=admin&tls=true");
    expect(buildMongoUri({ ...baseCreds, tls: "disable" })).toContain(
      "?tls=false",
    );
    expect(buildMongoUri(baseCreds)).not.toContain("tls=");
  });
});

describe("coerceJsonObject", () => {
  it("passes objects through and treats blank as undefined", () => {
    expect(coerceJsonObject({ a: 1 }, "Filter")).toEqual({ a: 1 });
    expect(coerceJsonObject(undefined, "Filter")).toBeUndefined();
    expect(coerceJsonObject("   ", "Filter")).toBeUndefined();
  });

  it("parses a JSON-object string", () => {
    expect(coerceJsonObject('{"a": 1}', "Filter")).toEqual({ a: 1 });
  });

  it("rejects arrays, non-object JSON, and malformed JSON with the field name", () => {
    expect(() => coerceJsonObject("[1]", "Filter")).toThrow(
      "Filter must be a JSON object",
    );
    expect(() => coerceJsonObject('"x"', "Sort")).toThrow(
      "Sort must be a JSON object",
    );
    expect(() => coerceJsonObject("{nope", "Filter")).toThrow(
      "Filter must be a JSON object",
    );
  });
});

describe("coerceJsonDocuments", () => {
  it("wraps a single document in an array", () => {
    expect(coerceJsonDocuments({ a: 1 })).toEqual([{ a: 1 }]);
    expect(coerceJsonDocuments('{"a": 1}')).toEqual([{ a: 1 }]);
  });

  it("accepts an array of documents", () => {
    expect(coerceJsonDocuments('[{"a":1},{"b":2}]')).toEqual([
      { a: 1 },
      { b: 2 },
    ]);
  });

  it("rejects empty arrays and non-object elements", () => {
    expect(() => coerceJsonDocuments("[]")).toThrow("at least one document");
    expect(() => coerceJsonDocuments("[1]")).toThrow("array of objects");
    expect(() => coerceJsonDocuments("")).toThrow("Documents is required");
  });
});

describe("coercePipeline / assertReadOnlyPipeline", () => {
  it("parses a JSON pipeline string", () => {
    expect(coercePipeline('[{"$match": {"a": 1}}]')).toEqual([
      { $match: { a: 1 } },
    ]);
  });

  it("rejects non-arrays and non-object stages", () => {
    expect(() => coercePipeline('{"$match": {}}')).toThrow(
      "JSON array of aggregation stages",
    );
    expect(() => coercePipeline("[]")).toThrow("aggregation stages");
    expect(() => coercePipeline('[{"$match": {}}, 5]')).toThrow(
      "aggregation stages",
    );
  });

  it("rejects $out and $merge write stages", () => {
    expect(() =>
      assertReadOnlyPipeline([{ $match: {} }, { $out: "other" }]),
    ).toThrow("$out");
    expect(() =>
      assertReadOnlyPipeline([{ $merge: { into: "other" } }]),
    ).toThrow("$merge");
    expect(() =>
      assertReadOnlyPipeline([{ $match: {} }, { $group: { _id: null } }]),
    ).not.toThrow();
  });
});

describe("assertNonEmptyFilterForMany", () => {
  it("throws on an empty or missing filter", () => {
    expect(() => assertNonEmptyFilterForMany({}, "Update Documents")).toThrow(
      "non-empty filter",
    );
    expect(() =>
      assertNonEmptyFilterForMany(undefined, "Delete Documents"),
    ).toThrow("non-empty filter");
    expect(() =>
      assertNonEmptyFilterForMany({ a: 1 }, "Update Documents"),
    ).not.toThrow();
  });
});

describe("normalizeBooleanFields", () => {
  it('maps "true"/"false" strings and strips blanks', () => {
    expect(
      normalizeBooleanFields({ many: "true", upsert: "false", other: "x" }, [
        "many",
        "upsert",
      ]),
    ).toEqual({ many: true, upsert: false, other: "x" });
    expect(normalizeBooleanFields({ many: "" }, ["many"])).toEqual({});
    expect(normalizeBooleanFields({ many: true }, ["many"])).toEqual({
      many: true,
    });
  });
});

describe("toJsonSafeBson", () => {
  it("converts BSON-like values by _bsontype duck typing", () => {
    const objectId = {
      _bsontype: "ObjectId",
      toHexString: () => "507f1f77bcf86cd799439011",
      toString: () => "507f1f77bcf86cd799439011",
    };
    const decimal = { _bsontype: "Decimal128", toString: () => "10.99" };
    const long = { _bsontype: "Long", toString: () => "9007199254740991" };
    const hugeLong = {
      _bsontype: "Long",
      toString: () => "9223372036854775807",
    };
    expect(
      toJsonSafeBson({ id: objectId, price: decimal, n: long, h: hugeLong }),
    ).toEqual({
      id: "507f1f77bcf86cd799439011",
      price: "10.99",
      n: 9007199254740991,
      h: "9223372036854775807",
    });
  });

  it("converts dates, bigints, and binary; recurses arrays", () => {
    expect(
      toJsonSafeBson({
        at: new Date("2026-01-02T03:04:05.000Z"),
        big: 10n,
        bin: Buffer.from("hi"),
        list: [new Date("2026-01-01T00:00:00.000Z"), null],
      }),
    ).toEqual({
      at: "2026-01-02T03:04:05.000Z",
      big: "10",
      bin: "aGk=",
      list: ["2026-01-01T00:00:00.000Z", null],
    });
  });

  it("round-trips real driver BSON values", async () => {
    const { BSON, ObjectId } = await import("mongodb");
    const doc = BSON.EJSON.deserialize(
      {
        _id: { $oid: "507f1f77bcf86cd799439011" },
        price: { $numberDecimal: "10.99" },
      },
      { relaxed: true },
    );
    expect(toJsonSafeBson(doc)).toEqual({
      _id: "507f1f77bcf86cd799439011",
      price: "10.99",
    });
    expect(toJsonSafeBson(new ObjectId("507f1f77bcf86cd799439011"))).toBe(
      "507f1f77bcf86cd799439011",
    );
  });
});

describe("createDocumentAccumulator", () => {
  it("stops at the document cap and reports truncation", () => {
    const acc = createDocumentAccumulator(2, 1_000_000);
    expect(acc.push({ a: 1 })).toBe(true);
    expect(acc.push({ a: 2 })).toBe(true);
    expect(acc.push({ a: 3 })).toBe(false);
    expect(acc.truncated).toBe(true);
    expect(acc.bytesExceeded).toBe(false);
    expect(acc.documents).toHaveLength(2);
  });

  it("stops at the byte budget and reports the overflow", () => {
    const acc = createDocumentAccumulator(100, 20);
    expect(acc.push({ a: "1234567890" })).toBe(true);
    expect(acc.push({ a: "1234567890" })).toBe(false);
    expect(acc.bytesExceeded).toBe(true);
    expect(acc.truncated).toBe(false);
  });
});
