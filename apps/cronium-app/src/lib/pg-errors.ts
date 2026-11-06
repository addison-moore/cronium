import { quotedForLog } from "@/lib/security/audit-entry";

/**
 * Reading a failed query's error. Drizzle wraps the driver's error in
 * DrizzleQueryError, so the details are on `cause`: a check of `error.code` never
 * matches on the real path, only in a test that rejects with a hand-built object.
 *
 * Logging one takes more care than reading it. Drizzle's message ends with every
 * bound value, the driver's `detail` and `where` quote the row or the JSON it
 * refused, and console.error prints all of those for an error passed as it is, as
 * well as a stack that starts with the message. So a catch block logs
 * describeFailure or failureWithStack, never the error or its `.message`.
 */
export interface DriverError {
  /** A SQLSTATE if Postgres answered, or a Node code such as ECONNREFUSED. */
  code?: string;
  message?: string;
  name?: string;
  /** Only on an error Postgres itself sent. */
  severity?: string;
}

/** More than any wrapping here takes, and it also stops a cycle. */
const MAX_CAUSES = 8;

/** How Drizzle's message starts. Anything after it can be a bound value. */
const DRIZZLE_MESSAGE = "Failed query:";

/**
 * Bound values shorter than this stay in a message that quotes them. They can't be
 * much of a secret, and replacing them would eat ordinary words of the message.
 */
const MIN_REPLACED_VALUE_CHARS = 6;

/** The error, what caused it, and so on: tRPC wraps Drizzle's wrapper in its own. */
function causeChain(error: unknown): DriverError[] {
  const chain: DriverError[] = [];
  let link = error;
  while (
    typeof link === "object" &&
    link !== null &&
    chain.length < MAX_CAUSES
  ) {
    chain.push(link);
    link = (link as { cause?: unknown }).cause;
  }
  return chain;
}

/** The deepest error that says anything: tRPC turns a plain cause into a blank one. */
export function driverError(error: unknown): DriverError {
  const chain = causeChain(error);
  return (
    chain.findLast(({ code, message }) => code ?? message) ?? chain[0] ?? {}
  );
}

export function pgErrorCode(error: unknown): string | undefined {
  return driverError(error).code;
}

/** A failed query, rather than something that went wrong around one. */
export function isQueryFailure(error: unknown): boolean {
  return causeChain(error).some(
    ({ message, severity }) =>
      severity !== undefined || String(message).includes(DRIZZLE_MESSAGE),
  );
}

/** Longest first, so one that contains another doesn't leave its remainder behind. */
function boundValues(error: unknown): string[] {
  return causeChain(error)
    .flatMap((link) => (link as { params?: unknown }).params)
    .filter(
      (value): value is string =>
        typeof value === "string" && value.length >= MIN_REPLACED_VALUE_CHARS,
    )
    .sort((a, b) => b.length - a.length);
}

function messageForLog(error: unknown, { message, name }: DriverError): string {
  // JSON.parse quotes what it couldn't parse: a request body, a stored setting.
  if (name === "SyntaxError")
    return "[message not logged, it quotes its input]";

  const text = String(message ?? "");
  // A wrapper with no cause, or an error built from Drizzle's message.
  const cut = text.indexOf(DRIZZLE_MESSAGE);
  const kept = cut === -1 ? text : `${text.slice(0, cut)}[query not logged]`;

  // Postgres quotes the value it refused in some messages, such as 22P02's.
  return boundValues(error).reduce(
    (remaining, value) => remaining.replaceAll(value, "[value]"),
    kept,
  );
}

/**
 * One line for the server log: the SQLSTATE or error name and the driver's own
 * message, without any of what's above. What's left of a message is masked, since a
 * trigger's own wording can quote a value in a form that can't be matched exactly.
 */
export function describeFailure(error: unknown): string {
  const failure: DriverError =
    typeof error === "object" && error !== null
      ? driverError(error)
      : { message: String(error) };
  const label = String(failure.code ?? failure.name ?? "Error");
  return quotedForLog(`${label}: ${messageForLog(error, failure)}`);
}

/**
 * Where it happened, without the message a stack starts with. If the message can't
 * be found there it was changed after the stack was captured, so what's in the stack
 * can't be told apart from the frames, and that error's stack is left out.
 */
export function stackFrames(error: unknown): string {
  for (const link of causeChain(error).reverse()) {
    const { message, stack } = link as { message?: unknown; stack?: unknown };
    if (typeof stack !== "string") continue;

    const text = typeof message === "string" ? message : "";
    const start = stack.indexOf(text);
    if (start === -1) continue;

    const frames = stack
      .slice(start + text.length)
      .split("\n")
      .filter((line) => /^\s+at /.test(line));
    if (frames.length > 0) return frames.join("\n");
  }
  return "";
}

/** For a catch block that would otherwise log the error itself, to keep its stack. */
export function failureWithStack(error: unknown): string {
  return [describeFailure(error), stackFrames(error)]
    .filter(Boolean)
    .join("\n");
}
