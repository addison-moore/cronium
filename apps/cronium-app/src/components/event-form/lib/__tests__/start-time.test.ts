/**
 * The start time field in a browser that isn't on UTC. An event stores one instant. The
 * field shows it in the browser's zone and reads what's typed the same way, so opening
 * an event and saving it changes nothing.
 *
 * Here that's every kind of zone and clock change that could matter. Each place that edits
 * an event runs it in `untouched-save.test.tsx`.
 */
import { inTimeZone } from "../../../../../../../tests/in-time-zone";
import { buildEventFormDefaults } from "../event-form-defaults";
import { buildEventPayload } from "../event-payload";

/** What the field shows for a stored time. */
function shownFor(stored: string) {
  return buildEventFormDefaults({ startTime: new Date(stored) }).startTime;
}

/** What a save sends after the field was left holding `value`. */
function savedFrom(value: string | null | undefined, stored?: string) {
  return buildEventPayload(
    { ...buildEventFormDefaults(), startTime: value },
    stored ? new Date(stored) : undefined,
  ).startTime;
}

/** What opening an event and pressing save sends. */
function savedUntouched(stored: string) {
  return savedFrom(shownFor(stored), stored);
}

const STORED = "2027-03-04T05:06:00.000Z";
const STORED_WITH_SECONDS = "2027-03-04T05:06:30.500Z";

describe.each([
  ["UTC", "2027-03-04T05:06"],
  // Behind UTC, so on the day before
  ["America/Los_Angeles", "2027-03-03T21:06"],
  // A half-hour offset
  ["Asia/Kolkata", "2027-03-04T10:36"],
  // As far ahead as zones go
  ["Pacific/Kiritimati", "2027-03-04T19:06"],
])("in %s", (zone, shown) => {
  inTimeZone(zone);

  it("shows the stored time in that zone", () => {
    expect(shownFor(STORED)).toBe(shown);
  });

  it("takes a stored time given as a string", () => {
    const stored = STORED_WITH_SECONDS;
    const startTime = buildEventFormDefaults({
      startTime: stored as never,
    }).startTime;
    expect(startTime).toBe(shown);
    expect(
      buildEventPayload({ ...buildEventFormDefaults(), startTime }, stored)
        .startTime,
    ).toBe(stored);
  });

  it("reads a time typed into the field as that zone's", () => {
    expect(savedFrom(shown)).toBe(STORED);
  });

  it.each([
    ["on the minute", STORED],
    ["with seconds", STORED_WITH_SECONDS],
  ])("keeps a time %s through untouched saves", (_name, stored) => {
    const first = savedUntouched(stored);
    expect(first).toBe(stored);
    expect(savedUntouched(first!)).toBe(stored);
  });

  it("doesn't read it in the zone cron schedules use", () => {
    const defaults = buildEventFormDefaults({
      startTime: new Date(STORED),
      customSchedule: "0 3 * * 1",
      timezone: "Pacific/Pago_Pago",
    });
    expect(defaults.startTime).toBe(shown);
  });
});

describe("around the clocks changing, in America/Los_Angeles", () => {
  inTimeZone("America/Los_Angeles");

  it("uses the offset on that date, not today's", () => {
    // Winter is 8 hours behind, summer 7.
    expect(shownFor("2027-01-04T05:06:00.000Z")).toBe("2027-01-03T21:06");
    expect(shownFor("2027-07-04T05:06:00.000Z")).toBe("2027-07-03T22:06");
  });

  // Clocks go back at 02:00 on 2027-11-07, so 01:30 happens twice that morning. The
  // string can only be read as the first of the two.
  it.each([
    ["first", "2027-11-07T08:30:00.000Z"],
    ["second", "2027-11-07T09:30:00.000Z"],
  ])("keeps the %s 01:30 of the hour they repeat", (_name, stored) => {
    expect(shownFor(stored)).toBe("2027-11-07T01:30");
    expect(savedUntouched(stored)).toBe(stored);
  });

  it("reads a typed 01:30 from that hour as the first", () => {
    expect(savedFrom("2027-11-07T01:30")).toBe("2027-11-07T08:30:00.000Z");
  });
});

describe("after the field changes, in America/Los_Angeles", () => {
  inTimeZone("America/Los_Angeles");

  it("saves the new time", () => {
    expect(savedFrom("2027-03-03T22:00", STORED_WITH_SECONDS)).toBe(
      "2027-03-04T06:00:00.000Z",
    );
  });

  it("keeps the stored time when changed back to it", () => {
    expect(savedFrom("2027-03-03T21:06", STORED_WITH_SECONDS)).toBe(
      STORED_WITH_SECONDS,
    );
  });

  it("saves a time set on an event that had none", () => {
    expect(savedFrom("2027-03-03T21:06")).toBe(STORED);
  });

  it("saves nothing once it's cleared", () => {
    expect(savedFrom("", STORED)).toBeNull();
    expect(savedFrom(null, STORED)).toBeNull();
  });
});
