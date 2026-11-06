/**
 * A script far longer than an exec argument can be, through the whole stack: saved over
 * the API, run from a real job, in a real container with the production sandbox. A job
 * container gets its script on stdin, because Linux refuses any one argument over 131,072
 * bytes and about 2 MiB across all of them, so as an argument a longer script fails as
 * the container starts. Only a real exec shows that.
 */
import {
  APP_URL,
  FatalPollError,
  poll,
  pool,
  seedPrincipal,
  trpc,
} from "./helpers";

let token: string;

beforeAll(async () => {
  ({ token } = await seedPrincipal());
});

afterAll(async () => {
  await pool.end();
});

/** Prints a line first and last, with comments in between to reach `size` bytes. */
function paddedScript(first: string, last: string, size: number): string {
  const firstLine = `echo "${first}"\n`;
  const lastLine = `echo "${last}"\n`;
  const comment = "# padding héllo ✓\n";
  const room = size - firstLine.length - lastLine.length;
  const script =
    firstLine +
    comment.repeat(Math.ceil(room / Buffer.byteLength(comment))) +
    lastLine;
  expect(Buffer.byteLength(script)).toBeGreaterThanOrEqual(size);
  return script;
}

describe("a long script in a container", () => {
  it.each([
    ["one argument", 132_000],
    ["all arguments together", 3_000_000],
  ])("runs past the limit on %s", async (_limit, size) => {
    const marker = `e2e-long-${size}-${Date.now().toString(36)}`;
    const event = await trpc<{ id: number }>(token, "events.create", {
      name: marker,
      type: "BASH",
      content: paddedScript(`FIRST:${marker}`, `LAST:${marker}`, size),
      triggerType: "MANUAL",
      status: "DRAFT",
    });

    const started = await fetch(`${APP_URL}/api/events/${event.id}/execute`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(started.status).toBe(202);
    const { logId } = (await started.json()) as { logId: number };

    const log = await poll<{ output: string }>(
      `log ${logId} to finish`,
      async () => {
        const res = await fetch(`${APP_URL}/api/logs/${logId}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        const body = (await res.json()) as { status: string; output: string };
        if (["FAILURE", "TIMEOUT", "PARTIAL"].includes(body.status)) {
          throw new FatalPollError(`run ended: ${JSON.stringify(body)}`);
        }
        return body.status === "SUCCESS" ? body : undefined;
      },
      { timeoutMs: 150_000 },
    );

    // The last line proves the whole script arrived and ran.
    expect(log.output).toContain(`FIRST:${marker}`);
    expect(log.output).toContain(`LAST:${marker}`);
  });
});
