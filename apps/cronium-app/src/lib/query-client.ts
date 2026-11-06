import {
  MutationCache,
  QueryClient,
  matchMutation,
  type Mutation,
} from "@tanstack/react-query";
import { getMutationKey, getQueryKey } from "@trpc/react-query";
import { trpc } from "@/lib/trpc";

function isUpdate(mutation: Mutation<unknown, unknown, unknown>): boolean {
  return matchMutation(
    { mutationKey: getMutationKey(trpc.events.update), exact: true },
    mutation,
  );
}

/** Writes to an event that answer `{ success: true }` rather than the row. */
function isOtherEventWrite(
  mutation: Mutation<unknown, unknown, unknown>,
): boolean {
  return [
    getMutationKey(trpc.events.activate),
    getMutationKey(trpc.events.deactivate),
    getMutationKey(trpc.events.resetCounter),
  ].some((mutationKey) =>
    matchMutation({ mutationKey, exact: true }, mutation),
  );
}

/**
 * The edit forms start from the cached `events.getById` copy and a save sends all of
 * it back, so a copy left behind by a write doesn't only look wrong: the next save
 * puts the old values back on the server and reports success.
 *
 * This is on the cache, not on each mutation, because the two sides don't know about
 * each other. The events list's status menu has no idea the event page holds a copy,
 * and a screen added later is covered without having to remember.
 */
async function keepCachedEventCurrent(
  client: QueryClient,
  mutation: Mutation<unknown, unknown, unknown>,
  variables: unknown,
  answer: unknown,
): Promise<void> {
  const saved = isUpdate(mutation);
  if (!saved && !isOtherEventWrite(mutation)) return;

  const { id } = variables as { id: number };
  const queryKey = getQueryKey(trpc.events.getById, { id }, "query");
  const filters = { queryKey, exact: true };

  if (saved) {
    // A read that left before this save could land after it with the old values.
    await client.cancelQueries(filters);
    client.setQueryData(queryKey, answer);
  } else {
    // Nothing to store instead, so a copy nothing is showing goes. The next screen
    // then has to fetch, rather than start a form from it while a fetch catches up.
    client.removeQueries({ ...filters, type: "inactive" });
  }

  // Not awaited, so a save doesn't look unfinished until this comes back. A save's
  // answer isn't the last word either: it's read before the schedule is worked out.
  void client.invalidateQueries(filters);
}

export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (answer, variables, _context, mutation) =>
        keepCachedEventCurrent(client, mutation, variables, answer),
    }),
  });
  return client;
}
