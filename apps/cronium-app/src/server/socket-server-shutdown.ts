/**
 * How long the socket server's stop may take. It lives here because importing
 * server.ts starts a server, and the test of this limit needs the same number.
 *
 * There is nothing to save when that process stops, so all this limits is the wait
 * for a peer that has stopped answering: Valkey, or a client partway through a request.
 */
export const SHUTDOWN_TIMEOUT_MS = 3_000;
