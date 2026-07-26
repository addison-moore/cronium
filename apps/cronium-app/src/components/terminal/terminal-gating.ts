export interface TerminalGateInputs {
  /** Component has mounted client-side (never initialize during SSR). */
  isClient: boolean;
  /** The terminal container div is rendered and available to xterm. */
  hasContainer: boolean;
  /** Auth state is still resolving — wait, don't connect speculatively. */
  isUserLoading: boolean;
  /** An authenticated user is present. */
  hasUser: boolean;
}

/**
 * Gate for terminal initialization. The terminal may only load xterm and open
 * a socket once the component is mounted client-side with its container
 * rendered and the authenticated user has fully resolved. Terminal sockets
 * authenticate with a ticket minted for the session user, so connecting
 * before auth settles (or without a user) is never allowed.
 */
export function canInitializeTerminal({
  isClient,
  hasContainer,
  isUserLoading,
  hasUser,
}: TerminalGateInputs): boolean {
  return isClient && hasContainer && !isUserLoading && hasUser;
}
