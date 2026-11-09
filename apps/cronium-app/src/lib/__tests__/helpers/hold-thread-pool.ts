/**
 * Holds every thread in libuv's pool until `work` is done or time is up, without using any
 * CPU, so a test can show that something doesn't need a thread: `dns.lookup` would wait
 * until they're let go.
 *
 * Each thread opens a FIFO to read, which waits until something opens it to write. Burning
 * the threads with `pbkdf2` instead takes seconds of every CPU, which slows the test files
 * running alongside, and it only holds the threads for as long as that work happens to take.
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `work` with every thread held. `done` records what got done, and the threads are let
 * go once `expected` different things have been, or after `within` milliseconds. Returns
 * what was done before that.
 */
export async function whileEveryThreadIsHeld(
  work: (done: (what: string) => void) => Promise<unknown>,
  expected: number,
  within = 10_000,
): Promise<string[]> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cronium-pool-"));
  const fifo = path.join(directory, "hold");
  execFileSync("mkfifo", [fifo]);
  const threads = Number(process.env.UV_THREADPOOL_SIZE ?? 4);
  // Queued before anything the work asks for, so these take every thread first.
  const held = Array.from({ length: threads }, () =>
    fs.promises.open(fifo, "r"),
  );

  const doneWhileHeld: string[] = [];
  let holding = true;
  const worked = work((what) => {
    if (holding) doneWhileHeld.push(what);
  });
  const deadline = performance.now() + within;
  while (
    new Set(doneWhileHeld).size < expected &&
    performance.now() < deadline
  ) {
    await sleep(5);
  }

  // Let them go: a writer lets every reader open. It stays open until they all have, so
  // none can start waiting again after it's gone.
  holding = false;
  let writer: number | undefined;
  while (writer === undefined) {
    try {
      writer = fs.openSync(
        fifo,
        fs.constants.O_WRONLY | fs.constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENXIO") throw error;
      await sleep(5);
    }
  }
  const handles = await Promise.all(held);
  fs.closeSync(writer);
  await Promise.all(handles.map((handle) => handle.close()));
  fs.rmSync(directory, { recursive: true, force: true });

  await worked;
  return doneWhileHeld;
}
