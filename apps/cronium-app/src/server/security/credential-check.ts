import { TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
import { failureWithStack } from "@/lib/pg-errors";

/**
 * What a caller reads when its credentials couldn't be checked. It's short enough for the
 * MCP bridge to pass on whole: it quotes the first 300 characters of a failed response.
 */
export const CREDENTIAL_CHECK_FAILED_MESSAGE =
  "Cronium couldn't check these credentials, usually because it can't reach its database. They may be fine, so keep them and try again shortly.";

/**
 * Credentials couldn't be checked, as when the database is down. That says nothing about
 * them, so it can't be a 401: a client takes a 401 to mean its token is bad and throws it
 * away, and the MCP bridge quits at startup on one. It still refuses the request. Thrown on a
 * tRPC path, tRPC answers it with a 503.
 */
export class CredentialCheckFailedError extends TRPCError {
  constructor(
    opts: { code: TRPC_ERROR_CODE_KEY; message: string } = {
      code: "SERVICE_UNAVAILABLE",
      message: CREDENTIAL_CHECK_FAILED_MESSAGE,
    },
  ) {
    super(opts);
  }
}

/**
 * An account's status couldn't be read. On tRPC only a token's client acts on the status, so
 * enforceLivePrincipal gives that client a 503, and this keeps the code and message that
 * cookie sessions and the other callers of getAuthorizedPrincipal have always had.
 */
export class AccountCheckFailedError extends CredentialCheckFailedError {
  constructor() {
    super({
      code: "UNAUTHORIZED",
      message: "Unable to verify account status",
    });
  }
}

/** Runs a lookup that a credential check depends on, where a failure isn't a verdict. */
export async function checkingCredentials<T>(
  whatFailed: string,
  lookup: () => Promise<T>,
): Promise<T> {
  try {
    return await lookup();
  } catch (error) {
    console.error(`${whatFailed}:`, failureWithStack(error));
    throw new CredentialCheckFailedError();
  }
}
