import { EventStatus, EventType, RunLocation } from "./schema";

/**
 * A script set to REMOTE runs only on its servers. With none left it has nowhere
 * it's meant to run: not the Cronium host, which it may never have been written
 * for. So it doesn't run, and a save can't put an event in that state. Where the
 * rule is enforced: dispatch, events.activate, events.update, and the REST create
 * and edit routes. Deleting a server pauses what it strands.
 */

/** Said wherever a run or a save is refused because of this rule. */
export const NO_SERVERS_MESSAGE =
  "This event runs only on servers and has none. Choose a server, or set it to run locally.";

interface EventLocation {
  type: EventType;
  runLocation: string | null;
  serverId?: number | null | undefined;
  servers?: ReadonlyArray<{ id: number }> | null | undefined;
}

/** HTTP requests and tool actions run in the worker wherever they're set to run. */
export function runsInProcess(type: EventType): boolean {
  return type === EventType.HTTP_REQUEST || type === EventType.TOOL_ACTION;
}

function hasServers(event: EventLocation): boolean {
  return Boolean(event.serverId) || (event.servers?.length ?? 0) > 0;
}

/**
 * Whether an event still has something to run with no servers: its local half,
 * or the worker.
 */
export function canRunWithoutServers(
  event: Pick<EventLocation, "type" | "runLocation">,
): boolean {
  return event.runLocation !== RunLocation.REMOTE || runsInProcess(event.type);
}

/** Whether an event has been left with no servers and nowhere else to run. */
export function isStrandedRemoteEvent(event: EventLocation): boolean {
  return !canRunWithoutServers(event) && !hasServers(event);
}

/**
 * Whether a save would create an event with no servers that needs some, as
 * events.create refuses to, or activate one that has nowhere to run. A save that
 * leaves all of that as it was goes through, so a row already in this state can
 * still be edited, including by a client that sends its unchanged fields back.
 */
export function saveStrandsEvent(
  current: EventLocation & { status: EventStatus },
  save: {
    type?: EventType | undefined;
    runLocation?: string | undefined;
    serverId?: number | null | undefined;
    selectedServerIds?: readonly number[] | undefined;
    status?: EventStatus | undefined;
  },
): boolean {
  const next: EventLocation = {
    type: save.type ?? current.type,
    runLocation: save.runLocation ?? current.runLocation,
    serverId: save.serverId === undefined ? current.serverId : save.serverId,
    servers:
      save.selectedServerIds?.map((id) => ({ id })) ?? current.servers ?? [],
  };
  if (next.runLocation === RunLocation.LOCAL || hasServers(next)) return false;

  const changesSetup =
    hasServers(current) ||
    next.runLocation !== current.runLocation ||
    next.type !== current.type;
  const activates =
    save.status === EventStatus.ACTIVE && current.status !== EventStatus.ACTIVE;
  return changesSetup || (activates && isStrandedRemoteEvent(next));
}
