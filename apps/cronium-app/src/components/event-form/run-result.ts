/**
 * How much of a run's result the event form draws. A read can return up to
 * MAX_UNIFIED_IO_OUTPUT_BYTES (5 MB), far more than a page can lay out, so this takes the
 * first part of it and says in words what it left out.
 */
import type { ShownResult } from "@/tools/types/tool-plugin";

/** Rows or documents drawn, at most. */
export const MOST_ROWS = 100;
/** Characters of one value in a row, at most. */
export const MOST_CELL_CHARACTERS = 200;
/** Characters of one document, at most. */
export const MOST_DOCUMENT_CHARACTERS = 5_000;
/** Characters drawn in all, at most: an answer, or the rows or documents together. */
export const MOST_CHARACTERS = 200_000;

export type FittedResult =
  | {
      type: "rows";
      columns: string[];
      /** Each value as text, or null for NULL, so it can be drawn unlike the text "NULL". */
      rows: (string | null)[][];
    }
  | { type: "documents"; documents: string[] }
  | {
      type: "text";
      format: "prose" | "json";
      text: string;
      about?: string;
      warning?: string;
    };

const number = (count: number) => count.toLocaleString("en-US");

/**
 * JSON that takes a BigInt, which superjson can hand over and JSON.stringify refuses.
 * Nothing in a JSON result is a function or a symbol, which stringify to nothing.
 */
const toJson = (value: unknown, indent?: number): string =>
  JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    indent,
  ) ?? "";

/** The first `most` characters and an ellipsis, without splitting a character in two. */
function cut(text: string, most: number): { text: string; cut: boolean } {
  if (text.length <= most) return { text, cut: false };
  // A character past U+FFFF takes two UTF-16 units, and half of one draws as a box.
  const end = /[\uD800-\uDBFF]/.test(text.charAt(most - 1)) ? most - 1 : most;
  return { text: `${text.slice(0, end)}…`, cut: true };
}

function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }
  if (value instanceof Date) return value.toISOString();
  return toJson(value);
}

/**
 * Items in order while they fit: at most MOST_ROWS, and MOST_CHARACTERS together, but
 * always the first, so something shows. Whether any drawn was cut short comes back too.
 */
function fitItems<Drawn>(
  items: readonly unknown[],
  fit: (item: unknown) => { drawn: Drawn; length: number; cut: boolean },
): { drawn: Drawn[]; cut: boolean } {
  const drawn: Drawn[] = [];
  let length = 0;
  let anyCut = false;
  for (const item of items) {
    if (drawn.length >= MOST_ROWS) break;
    const next = fit(item);
    if (drawn.length > 0 && length + next.length > MOST_CHARACTERS) break;
    drawn.push(next.drawn);
    length += next.length;
    anyCut ||= next.cut;
  }
  return { drawn, cut: anyCut };
}

const firstOf = (drawn: number, total: number, noun: string): string[] =>
  drawn < total
    ? [`Showing the first ${number(drawn)} of ${number(total)} ${noun}.`]
    : [];

/** What of a result the form draws, and what it left out, in words. */
export function fitResult(shown: ShownResult): {
  fitted: FittedResult;
  cuts: string[];
} {
  switch (shown.type) {
    case "rows": {
      // Run Query always names its columns. Should a result ever come without, its rows'
      // keys are better than drawing rows with nothing in them.
      const columns =
        shown.columns.length > 0
          ? shown.columns
          : [
              ...new Set(
                shown.rows.flatMap((row) =>
                  row && typeof row === "object" ? Object.keys(row) : [],
                ),
              ),
            ];
      const { drawn, cut: valuesCut } = fitItems(shown.rows, (row) => {
        let length = 0;
        let anyCut = false;
        const cells = columns.map((column) => {
          const text = cellText(
            (row as Record<string, unknown> | null)?.[column],
          );
          if (text === null) return null;
          const fitted = cut(text, MOST_CELL_CHARACTERS);
          length += fitted.text.length;
          anyCut ||= fitted.cut;
          return fitted.text;
        });
        return { drawn: cells, length, cut: anyCut };
      });
      return {
        fitted: { type: "rows", columns, rows: drawn },
        cuts: [
          ...firstOf(drawn.length, shown.rows.length, "rows"),
          ...(valuesCut
            ? [
                `Values longer than ${number(MOST_CELL_CHARACTERS)} characters are cut short.`,
              ]
            : []),
        ],
      };
    }
    case "documents": {
      const { drawn, cut: documentsCut } = fitItems(
        shown.documents,
        (document) => {
          const fitted = cut(toJson(document, 2), MOST_DOCUMENT_CHARACTERS);
          return {
            drawn: fitted.text,
            length: fitted.text.length,
            cut: fitted.cut,
          };
        },
      );
      return {
        fitted: { type: "documents", documents: drawn },
        cuts: [
          ...firstOf(drawn.length, shown.documents.length, "documents"),
          ...(documentsCut
            ? [
                `Documents longer than ${number(MOST_DOCUMENT_CHARACTERS)} characters are cut short.`,
              ]
            : []),
        ],
      };
    }
    case "text": {
      const fitted = cut(shown.text, MOST_CHARACTERS);
      return {
        fitted: { ...shown, text: fitted.text },
        cuts: fitted.cut
          ? [
              `Showing the first ${number(MOST_CHARACTERS)} of ${number(shown.text.length)} characters.`,
            ]
          : [],
      };
    }
  }
}
