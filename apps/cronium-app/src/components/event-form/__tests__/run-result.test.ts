/**
 * @jest-environment node
 *
 * A read can return up to MAX_UNIFIED_IO_OUTPUT_BYTES (5 MB), which the form can't draw,
 * so it draws a part and says what it left out. These are the limits and the words.
 */
import {
  fitResult,
  MOST_CELL_CHARACTERS,
  MOST_CHARACTERS,
  MOST_DOCUMENT_CHARACTERS,
  MOST_ROWS,
} from "../run-result";
import { MAX_UNIFIED_IO_OUTPUT_BYTES } from "@/lib/unified-io/limits";

const rows = (count: number, row: (n: number) => Record<string, unknown>) =>
  Array.from({ length: count }, (_, n) => row(n + 1));

describe("a table of rows", () => {
  it("draws every value as text, and NULL as nothing", () => {
    const { fitted, cuts } = fitResult({
      type: "rows",
      columns: ["n", "s", "b", "j", "none", "big", "when"],
      rows: [
        {
          n: 1.5,
          s: "a\tb",
          b: false,
          j: { tags: ["x"], deep: { y: null } },
          none: null,
          big: BigInt("9007199254740993"),
          when: new Date("2026-11-09T10:00:00.000Z"),
        },
      ],
    });

    expect(fitted).toEqual({
      type: "rows",
      columns: ["n", "s", "b", "j", "none", "big", "when"],
      rows: [
        [
          "1.5",
          "a\tb",
          "false",
          '{"tags":["x"],"deep":{"y":null}}',
          null,
          "9007199254740993",
          "2026-11-09T10:00:00.000Z",
        ],
      ],
    });
    expect(cuts).toEqual([]);
  });

  it("goes by the columns, so a missing value is NULL and an extra one isn't drawn", () => {
    expect(
      fitResult({
        type: "rows",
        columns: ["a", "b"],
        rows: [{ a: 1, extra: 2 }],
      }).fitted,
    ).toEqual({ type: "rows", columns: ["a", "b"], rows: [["1", null]] });
  });

  it("keeps the columns of a query that returned no rows", () => {
    expect(fitResult({ type: "rows", columns: ["id"], rows: [] })).toEqual({
      fitted: { type: "rows", columns: ["id"], rows: [] },
      cuts: [],
    });
  });

  it(`draws the first ${MOST_ROWS} rows, and says how many there were`, () => {
    const { fitted, cuts } = fitResult({
      type: "rows",
      columns: ["id"],
      rows: rows(10_000, (n) => ({ id: n })),
    });

    expect(fitted.type === "rows" && fitted.rows).toEqual(
      rows(MOST_ROWS, (n) => ({ id: n })).map(({ id }) => [String(id)]),
    );
    expect(cuts).toEqual(["Showing the first 100 of 10,000 rows."]);
  });

  it("says nothing about a count that fits", () => {
    expect(
      fitResult({
        type: "rows",
        columns: ["id"],
        rows: rows(MOST_ROWS, (n) => ({ id: n })),
      }).cuts,
    ).toEqual([]);
  });

  it(`cuts a value at ${MOST_CELL_CHARACTERS} characters, and says so once`, () => {
    const long = "x".repeat(MOST_CELL_CHARACTERS + 1);
    const { fitted, cuts } = fitResult({
      type: "rows",
      columns: ["a", "b"],
      rows: [
        { a: long, b: "short" },
        { a: { text: long }, b: "x".repeat(MOST_CELL_CHARACTERS) },
      ],
    });

    expect(fitted.type === "rows" && fitted.rows).toEqual([
      [`${"x".repeat(MOST_CELL_CHARACTERS)}…`, "short"],
      [
        `${'{"text":"'.concat("x".repeat(MOST_CELL_CHARACTERS - 9))}…`,
        "x".repeat(MOST_CELL_CHARACTERS),
      ],
    ]);
    expect(cuts).toEqual(["Values longer than 200 characters are cut short."]);
  });

  it("doesn't cut a character in two", () => {
    const value = `${"x".repeat(MOST_CELL_CHARACTERS - 1)}😀 and more`;
    const { fitted } = fitResult({
      type: "rows",
      columns: ["a"],
      rows: [{ a: value }],
    });
    expect(fitted.type === "rows" && fitted.rows[0]?.[0]).toBe(
      `${"x".repeat(MOST_CELL_CHARACTERS - 1)}…`,
    );
  });

  it(`stops at ${MOST_CHARACTERS.toLocaleString("en-US")} characters, however few rows that is`, () => {
    const wide = Object.fromEntries(
      Array.from({ length: 100 }, (_, n) => [
        `c${n}`,
        "y".repeat(MOST_CELL_CHARACTERS),
      ]),
    );
    const { fitted, cuts } = fitResult({
      type: "rows",
      columns: Object.keys(wide),
      rows: rows(300, () => wide),
    });

    // 100 values of 200 characters are 20,000 a row.
    expect(fitted.type === "rows" && fitted.rows).toHaveLength(10);
    expect(cuts).toEqual(["Showing the first 10 of 300 rows."]);
  });

  it("draws one row whatever its size", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 2_000 }, (_, n) => [`c${n}`, "y".repeat(200)]),
    );
    const { fitted, cuts } = fitResult({
      type: "rows",
      columns: Object.keys(wide),
      rows: rows(2, () => wide),
    });
    expect(fitted.type === "rows" && fitted.rows).toHaveLength(1);
    expect(cuts).toEqual(["Showing the first 1 of 2 rows."]);
  });
});

describe("documents", () => {
  it("draws each one as JSON, laid out", () => {
    expect(
      fitResult({
        type: "documents",
        documents: [{ _id: "a1", tags: ["x"] }, { _id: "a2" }],
      }),
    ).toEqual({
      fitted: {
        type: "documents",
        documents: [
          JSON.stringify({ _id: "a1", tags: ["x"] }, null, 2),
          JSON.stringify({ _id: "a2" }, null, 2),
        ],
      },
      cuts: [],
    });
  });

  it(`draws the first ${MOST_ROWS}, and says how many there were`, () => {
    const { fitted, cuts } = fitResult({
      type: "documents",
      documents: rows(250, (n) => ({ n })),
    });
    expect(fitted.type === "documents" && fitted.documents).toHaveLength(
      MOST_ROWS,
    );
    expect(cuts).toEqual(["Showing the first 100 of 250 documents."]);
  });

  it(`cuts a document at ${MOST_DOCUMENT_CHARACTERS.toLocaleString("en-US")} characters, and says so`, () => {
    const big = { values: rows(5_000, (n) => ({ n })) };
    const { fitted, cuts } = fitResult({
      type: "documents",
      documents: [big, { small: true }],
    });

    expect(fitted.type === "documents" && fitted.documents).toEqual([
      `${JSON.stringify(big, null, 2).slice(0, MOST_DOCUMENT_CHARACTERS)}…`,
      JSON.stringify({ small: true }, null, 2),
    ]);
    expect(cuts).toEqual([
      "Documents longer than 5,000 characters are cut short.",
    ]);
  });

  it(`stops at ${MOST_CHARACTERS.toLocaleString("en-US")} characters`, () => {
    const big = { text: "z".repeat(MOST_DOCUMENT_CHARACTERS) };
    const { fitted, cuts } = fitResult({
      type: "documents",
      documents: rows(60, () => big),
    });
    // Each is cut to 5,000 characters and an ellipsis.
    expect(fitted.type === "documents" && fitted.documents).toHaveLength(39);
    expect(cuts).toEqual([
      "Showing the first 39 of 60 documents.",
      "Documents longer than 5,000 characters are cut short.",
    ]);
  });
});

describe("text", () => {
  it("draws an answer whole, with what was said about it", () => {
    expect(
      fitResult({
        type: "text",
        format: "prose",
        text: "Paris.\n\nIt's the capital.",
        about: "Answered by m.",
        warning: "It stopped at Max Tokens, so the answer may be cut short.",
      }),
    ).toEqual({
      fitted: {
        type: "text",
        format: "prose",
        text: "Paris.\n\nIt's the capital.",
        about: "Answered by m.",
        warning: "It stopped at Max Tokens, so the answer may be cut short.",
      },
      cuts: [],
    });
  });

  it(`cuts one past ${MOST_CHARACTERS.toLocaleString("en-US")} characters, and says how long it was`, () => {
    const text = "w".repeat(MAX_UNIFIED_IO_OUTPUT_BYTES);
    const { fitted, cuts } = fitResult({ type: "text", format: "json", text });

    expect(fitted).toEqual({
      type: "text",
      format: "json",
      text: `${"w".repeat(MOST_CHARACTERS)}…`,
    });
    expect(cuts).toEqual([
      "Showing the first 200,000 of 5,242,880 characters.",
    ]);
  });
});
