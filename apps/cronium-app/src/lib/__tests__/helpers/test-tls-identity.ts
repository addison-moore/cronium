/**
 * A throwaway self-signed certificate and key, for a test's server on a real socket.
 * They were made for this file, protect nothing, and the clients under test don't verify
 * them. A test that needs TLS can't generate these: Node has no API for it.
 */
export const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg/ObjwX2hfzj0k8Pf
ZzFtFurwyBCGJxE6rHk5dBwqtL6hRANCAARc1ExXC/Fg5adwzHAIGsNy9swMpmYW
6MyQSEDSpQ1y43Ow4O2nrikrxfU8ZKd6Ww4RTiqgwP/hY8O/29wOBB9O
-----END PRIVATE KEY-----
`;

export const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBZDCCAQqgAwIBAgIUY7wJoRnmrEsuQCXOKRJ3AQZCH6AwCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMY3Jvbml1bS10ZXN0MCAXDTI2MTEwNjIxMjg1MFoYDzIxMjYx
MDEzMjEyODUwWjAXMRUwEwYDVQQDDAxjcm9uaXVtLXRlc3QwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAARc1ExXC/Fg5adwzHAIGsNy9swMpmYW6MyQSEDSpQ1y43Ow
4O2nrikrxfU8ZKd6Ww4RTiqgwP/hY8O/29wOBB9OozIwMDAdBgNVHQ4EFgQUpKjH
EO+yjkk5JTgdR7Cx6OgR/5YwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNI
ADBFAiEAuizP4qNxUQsRO6Mur/UeS53LiLkoAuGFjXpt2VfbgXYCIGkrn+fAyCte
hYKawsJDDilWJJug8qxCum2hm1jUsFJz
-----END CERTIFICATE-----
`;
