/**
 * Runs a test file or a describe block in a time zone. Jest's zone isn't fixed: it's the
 * machine's, and on CI that's UTC, the one zone where code that mixes up UTC and local
 * time can't fail.
 *
 * Jest gives a test a copy of process.env, and setting TZ on a copy changes nothing. Node
 * re-reads the zone when the real one is set, and this reaches it. A Jest worker runs one
 * test file at a time, so no other file sees the change.
 */
import { runInThisContext } from "node:vm";

const realEnv = (runInThisContext("process") as NodeJS.Process).env;

export function inTimeZone(zone: string) {
  const machineZone = realEnv.TZ;
  beforeAll(() => {
    realEnv.TZ = zone;
  });
  afterAll(() => {
    if (machineZone === undefined) delete realEnv.TZ;
    else realEnv.TZ = machineZone;
  });
}
