/**
 * The words for `ToolAction.testRun`, what the event form's button does with an action.
 * Server-safe and client-safe: an action's module is imported by both.
 */
import type {
  ActionCheck,
  ActionTestRun,
  ShownResult,
} from "@/tools/types/tool-plugin";

const NO_TEST_MODE = "There's no test mode: this really";

/** "1 row", "2 rows", "0 rows". */
export const counted = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The action stops at `isTest`, so this says nothing about the credential or the service. */
export const simulatedRun = (service: string): ActionTestRun => ({
  kind: "simulated",
  explains: `Checks the parameters only. Nothing goes to ${service}, so this doesn't show that the credential works.`,
  succeeded: () => `Nothing was sent to ${service}. The parameters are valid.`,
});

/**
 * Really runs, on a path that refuses a write. The form doesn't ask first, and shows what
 * came back.
 */
export const readRun = <Counted, Shown>(
  howMany: (result: Counted) => string,
  shows: (result: Shown) => ShownResult,
): ActionTestRun => ({
  kind: "reads",
  explains: "Really runs on this database, read-only.",
  succeeded: (result) =>
    `Returned ${howMany(result as Counted)}. It ran read-only, so no data changed.`,
  shows: (result) => shows(result as Shown),
});

/**
 * A check the action does when `isTest` is set, offered beside the real run, which it
 * stops short of. `label` names its button and `does` finishes "<label> ...". `says` is
 * the toast: what the check showed, then what it didn't.
 */
export interface CheckFirst<Result> {
  label: string;
  does: string;
  says: (result: Result) => string;
}

export const checkFirst = <Result>(
  label: string,
  does: string,
  says: (result: Result) => string,
): CheckFirst<Result> => ({ label, does, says });

/**
 * What a real run's question says, and the check beside it if there is one. With a
 * check there is a test mode, so the question only says what's real.
 */
const realRun = <Checked>(
  does: string,
  check: CheckFirst<Checked> | undefined,
): { explains: string; check?: ActionCheck } =>
  check
    ? {
        explains: `This really ${does}.`,
        check: {
          label: check.label,
          explains: `${check.label} ${check.does}.`,
          runDoes: `really ${does}`,
          succeeded: (result) => check.says(result as Checked),
        },
      }
    : { explains: `${NO_TEST_MODE} ${does}.` };

/** Really delivers something to someone. `does` finishes "this really ...". */
export const sendRun = <Result, Checked = never>(
  does: string,
  says: (result: Result) => string,
  check?: CheckFirst<Checked>,
): ActionTestRun => ({
  kind: "sends",
  ...realRun(does, check),
  succeeded: (result) => says(result as Result),
});

/**
 * Really calls a service that may charge for it. `does` finishes "this really ...". The
 * form shows what came back, which was paid for.
 */
export const spendRun = <Result>(
  does: string,
  says: string,
  shows: (result: Result) => ShownResult,
): ActionTestRun => ({
  kind: "spends",
  explains: `${NO_TEST_MODE} ${does}.`,
  succeeded: () => says,
  shows: (result) => shows(result as Result),
});

/** Really changes data. */
export const writeRun = <Result, Checked = never>(
  says: (result: Result) => string,
  check?: CheckFirst<Checked>,
): ActionTestRun => ({
  kind: "writes",
  ...realRun("changes your data, and can't be undone", check),
  succeeded: (result) => says(result as Result),
});

// The form calls these in its success handler, where a throw would turn a run that
// worked into a failure, so they take whatever came back.

/** Run Query's `{ columns, rows }`, as a table. */
export const rowsShown = (
  result: { columns?: string[]; rows?: Record<string, unknown>[] } | null,
): ShownResult => ({
  type: "rows",
  columns: result?.columns ?? [],
  rows: result?.rows ?? [],
});

/** Find's and Aggregate's `{ documents }`, each as JSON. */
export const documentsShown = (
  result: { documents?: unknown[] } | null,
): ShownResult => ({
  type: "documents",
  documents: result?.documents ?? [],
});
