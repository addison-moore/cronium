/**
 * Valkey couldn't be asked: there's no connection, or it refused or never answered the
 * command, as with a write past `maxmemory` under `noeviction`. Unlike the null or false
 * cacheService's forgiving methods give back then, this says nothing about the key.
 *
 * In a module of its own, so a route can tell it apart without loading the cache itself.
 */
export class CacheUnavailableError extends Error {
  override readonly name = "CacheUnavailableError";
}
