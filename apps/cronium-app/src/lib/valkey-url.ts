/** ioredis accepts Redis protocols but does not parse Valkey aliases. */
export function normalizeValkeyUrl(url: string): string {
  if (/^valkey:\/\//i.test(url)) {
    return url.replace(/^valkey:\/\//i, "redis://");
  }
  if (/^valkeys:\/\//i.test(url)) {
    return url.replace(/^valkeys:\/\//i, "rediss://");
  }
  return url;
}
