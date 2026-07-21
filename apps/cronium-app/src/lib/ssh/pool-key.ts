import { createHmac, randomBytes } from "node:crypto";

export type SSHAuthType = "privateKey" | "password";
declare const sshConnectionScopeBrand: unique symbol;
export type SSHConnectionScope = string & {
  readonly [sshConnectionScopeBrand]: true;
};

export interface SSHPoolKeyInput {
  connectionScope: SSHConnectionScope;
  host: string;
  username: string;
  port: number;
  authType: SSHAuthType;
  authCredential: string;
}

// A random, process-local key prevents pool identifiers from becoming an
// offline oracle for passwords or private keys if logs/debug state leak.
const processPoolKey = randomBytes(32);

export function createServerSSHConnectionScope(
  userId: string,
  serverId: number,
): SSHConnectionScope {
  if (!userId || !Number.isInteger(serverId) || serverId <= 0) {
    throw new Error("A valid user and server are required for SSH pooling");
  }

  return JSON.stringify({
    kind: "server",
    userId,
    serverId,
  }) as SSHConnectionScope;
}

/**
 * Return an opaque key unique to a Cronium resource, endpoint, auth mechanism,
 * and credential version. Neither the credential nor tenant/resource IDs are
 * included in the returned/logged key.
 */
export function createSSHPoolKey(input: SSHPoolKeyInput): string {
  if (!input.connectionScope || !input.authCredential) {
    throw new Error("SSH connection scope and credential are required");
  }
  if (!input.host || !input.username || !Number.isInteger(input.port)) {
    throw new Error("Invalid SSH endpoint");
  }

  const credentialFingerprint = createHmac("sha256", processPoolKey)
    .update(input.authType)
    .update("\0")
    .update(input.authCredential)
    .digest("base64url");

  const canonicalIdentity = JSON.stringify({
    connectionScope: input.connectionScope,
    host: input.host,
    username: input.username,
    port: input.port,
    authType: input.authType,
    credentialFingerprint,
  });

  return `ssh-pool:${createHmac("sha256", processPoolKey)
    .update(canonicalIdentity)
    .digest("base64url")}`;
}
