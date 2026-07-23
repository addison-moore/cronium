/**
 * @jest-environment node
 */
// Factory-mock the materializer before any imports: its import chain reaches
// @/server/db and @/env.mjs (ESM t3-env crashes jest).
jest.mock("@/lib/scheduling/materialize", () => ({
  refreshEventSchedule: jest.fn(),
}));

import { ScriptScheduler } from "../scheduler";
import { refreshEventSchedule } from "@/lib/scheduling/materialize";
import type { EventWithRelations } from "@/server/storage";

const mockRefresh = refreshEventSchedule as jest.Mock;

describe("ScriptScheduler facade", () => {
  let scheduler: ScriptScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRefresh.mockResolvedValue(undefined);
    scheduler = new ScriptScheduler();
  });

  it("scheduleScript re-materializes the event's durable schedule", async () => {
    const event = { id: 42 } as EventWithRelations;

    await scheduler.scheduleScript(event);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith(42);
  });

  it("updateScript re-materializes by event id", async () => {
    await scheduler.updateScript(7);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith(7);
  });

  it("deleteScript re-materializes by event id (clears when non-ACTIVE)", async () => {
    await scheduler.deleteScript(99);

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith(99);
  });

  it("propagates materializer failures to the caller", async () => {
    mockRefresh.mockRejectedValue(new Error("db unavailable"));

    await expect(scheduler.updateScript(7)).rejects.toThrow("db unavailable");
  });
});
